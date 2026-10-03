const fs = require("fs");
const path = require("path");
const config = require("../config/config.json");
const api = require("./api-client");
const { activeBudgetCap } = require("./recipe-helpers");
const { checkSrcIntegrity } = require("./integrity");
const { standardsFreshness } = require("./policy-check");

const ENV_PATH = path.join(__dirname, "../.env");
const FALLBACK_ENV_PATH = path.join(__dirname, "../../../.env");
const ENV_PATHS = process.env.META_ADS_IGNORE_ENV_FILES === "1" ? [] : [ENV_PATH];

function readEnvFile({ paths = ENV_PATHS, existsSync = fs.existsSync, readFileSync = fs.readFileSync } = {}) {
  const env = {};
  for (const envPath of paths.slice().reverse()) {
    if (!existsSync(envPath)) continue;

    let lines;
    try {
      lines = readFileSync(envPath, "utf8").split(/\r?\n/);
    } catch (error) {
      if (error.code === "EACCES" || error.code === "EPERM") continue;
      throw error;
    }
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;

      const key = trimmed.slice(0, eq).trim();
      const rawValue = trimmed.slice(eq + 1).trim();
      env[key] = rawValue.replace(/^['"]|['"]$/g, "");
    }
  }
  return env;
}

function envStatus(environment = process.env, fileEnv = readEnvFile()) {
  const required = config.requiredEnvVars || [];

  return required.map((name) => ({
    name,
    present: Boolean(environment[name] || fileEnv[name]),
    source: environment[name] ? "process" : fileEnv[name] ? "agent .env or workspace fallback" : null,
  }));
}

function liveCheck(name, status, detail) {
  return { name, status, detail };
}

function errorDetail(error) {
  return error?.message || "Unknown network error";
}

function isPermissionError(error) {
  return /\(code (10|200)\)|permission/i.test(errorDetail(error));
}

async function runLiveChecks(apiClient, accountId, appId) {
  const timeoutMs = 5000;
  const checks = [];
  // Identity of the connected ad account, from the Graph response only (never
  // from env or .env values), so a student can confirm they wired the right one.
  let connectedAccount = null;

  try {
    const account = await apiClient.apiCall(`/${accountId}`, "GET", null, {
      fields: "name,account_status,business",
    }, { timeoutMs });
    if (!String(account.id || accountId).startsWith("act_")) {
      checks.push(liveCheck("account_connection", "fail", "Meta returned an account ID that is not in act_ format."));
    } else {
      checks.push(liveCheck("account_connection", "pass", `Connected to ${account.name || accountId} (status ${account.account_status ?? "unknown"}).`));
      connectedAccount = {
        id: String(account.id || accountId),
        name: typeof account.name === "string" ? account.name : null,
        business: account.business && typeof account.business.name === "string" ? account.business.name : null,
        accountStatus: account.account_status ?? null,
      };
    }
  } catch (error) {
    checks.push(liveCheck("account_connection", "fail", `Meta rejected account verification: ${errorDetail(error)}`));
  }

  try {
    const app = await apiClient.apiCall(`/${appId}`, "GET", null, { fields: "name" }, { timeoutMs });
    checks.push(liveCheck("app_id", "pass", `Connected to Meta app ${app.name || appId}.`));
  } catch (error) {
    if (isPermissionError(error)) {
      checks.push(liveCheck("app_id", "skipped", `App ID check skipped because this token lacks app-read permission: ${errorDetail(error)}`));
    } else {
      checks.push(liveCheck("app_id", "fail", `Meta rejected app ID verification: ${errorDetail(error)}`));
    }
  }

  try {
    const account = await apiClient.apiCall(`/${accountId}`, "GET", null, {
      fields: "currency,timezone_name",
    }, { timeoutMs });
    checks.push(liveCheck("account_details", "pass", `Currency: ${account.currency || "unknown"}; timezone: ${account.timezone_name || "unknown"}.`));
  } catch (error) {
    checks.push(liveCheck("account_details", "fail", `Meta rejected account details verification: ${errorDetail(error)}`));
  }

  return { checks, account: connectedAccount };
}

function budgetCapStatus(environment = process.env, fileEnv = readEnvFile()) {
  const value = environment.META_ADS_MAX_DAILY_BUDGET_CENTS !== undefined ? environment.META_ADS_MAX_DAILY_BUDGET_CENTS : fileEnv.META_ADS_MAX_DAILY_BUDGET_CENTS;
  const cap = activeBudgetCap(value === undefined ? {} : { META_ADS_MAX_DAILY_BUDGET_CENTS: value });
  const message = cap.source === "default"
    ? `META_ADS_MAX_DAILY_BUDGET_CENTS is not set, so the default cap of ${cap.limitCents} cents per day applies to every budget write.`
    : cap.source === "env"
      ? `Budget writes are capped at ${cap.limitCents} cents per day by META_ADS_MAX_DAILY_BUDGET_CENTS.`
      : "META_ADS_MAX_DAILY_BUDGET_CENTS is set to an invalid value; every budget write is refused until it is a positive number.";
  const limitDollars = cap.limitCents === null ? null : `$${(cap.limitCents / 100).toFixed(2)}`;
  return { ...cap, limitDollars, writesEnabled: (environment.META_ADS_WRITES_ENABLED || fileEnv.META_ADS_WRITES_ENABLED) === "true", message };
}

// How this install reaches Meta. "api": this agent holds a token and calls the
// Graph API itself. "connector": Claude uses Meta's official Ads connector and
// this agent keeps the guardrails (policy check, budget cap, audit log) without
// a token. "not_set": neither yet. Never returns a setting's value.
function connectionMode(environment = process.env, fileEnv = readEnvFile()) {
  if (environment.META_ADS_ACCESS_TOKEN || fileEnv.META_ADS_ACCESS_TOKEN) return "api";
  const chosen = String(environment.META_ADS_CONNECTION || fileEnv.META_ADS_CONNECTION || "").trim().toLowerCase();
  return chosen === "connector" ? "connector" : "not_set";
}

async function readinessReport({ environment = process.env, fileEnv = readEnvFile(), apiClient = api, integrity = checkSrcIntegrity(), policyGuide = standardsFreshness() } = {}) {
  const vars = envStatus(environment, fileEnv);
  const connection = connectionMode(environment, fileEnv);
  const connectorMode = connection === "connector";
  const notPresent = vars.filter((item) => !item.present).map((item) => item.name);
  // In connector mode the token and app settings are not needed here: Claude
  // reaches Meta through the official connector. They are expected, not missing.
  const missing = connectorMode ? [] : notPresent;
  const credential = (name) => environment[name] || fileEnv[name];
  const skipDetail = connectorMode
    ? "Connector mode: Claude reaches Meta through the official Meta Ads connector, so this agent makes no live calls."
    : "Credentials are incomplete, live API checks skipped.";
  const live = notPresent.length
    ? {
        checks: [
          liveCheck("account_connection", "skipped", skipDetail),
          liveCheck("app_id", "skipped", skipDetail),
          liveCheck("account_details", "skipped", skipDetail),
        ],
        account: null,
      }
    : await runLiveChecks(apiClient, credential("META_ADS_ACCOUNT_ID"), credential("META_ADS_APP_ID"));
  const liveChecks = live.checks;
  const hasLiveFailure = liveChecks.some((check) => check.status === "fail");
  const writesEnabled = (environment.META_ADS_WRITES_ENABLED || fileEnv.META_ADS_WRITES_ENABLED) === "true";

  return {
    agent: "meta-ads",
    connection,
    status: connectorMode
      ? "connector_mode"
      : missing.length
      ? "offline_copilot_only"
      : hasLiveFailure ? "connection_check_failed" : "ready_for_live_api",
    writes: writesEnabled ? "on" : "off",
    account: live.account,
    apiVersion: config.apiVersion,
    integrity,
    policyGuide,
    warnings: [
      ...(integrity && integrity.ok === false ? [integrity.message] : []),
      ...(policyGuide && policyGuide.ok === false ? [policyGuide.message] : []),
    ],
    budgetCap: budgetCapStatus(environment, fileEnv),
    env: vars,
    liveChecks,
    optionalSettings: (config.optionalEnvVars || []).map((name) => ({
      name,
      present: Boolean(environment[name] || fileEnv[name]),
      source: environment[name] ? "process" : fileEnv[name] ? "agent .env or workspace fallback" : null,
    })),
    missing,
    ...(connectorMode ? { expectedMissing: notPresent } : {}),
    enabledNow: [
      "offline campaign drafts",
      "paused-by-default launch plans",
      "setup/readiness checks",
      "local JSON draft archive",
      "carousel creative previews (dry run)",
      "Meta policy check of ad text (policy check, offline)",
    ],
    blockedUntilCredentials: [
      "account lookup",
      "campaign sync",
      "audience/pixel listing",
      "live campaign/ad set/ad creation",
      "carousel creative creation (2 to 10 cards)",
      "performance reporting",
    ],
    guardrails: [
      "Campaign, ad set, and ad drafts remain PAUSED by default.",
      "Activation requires the account owner’s explicit approval.",
      "Budget increases require the account owner’s explicit approval.",
      "No live API writes run until Meta credentials are present.",
      "Carousel creatives are created without an ad; ads stay PAUSED until a human activates them.",
      "Credential values are redacted from every printed response, error and audit entry.",
      "Ad text is checked against Meta's Advertising Standards before every create; a BLOCK is refused unless --policy-override \"<reason>\" is given, and the override is audited.",
      "New ad sets send promoted_object (pixelId + customEventType such as PURCHASE or LEAD, or pageId for lead forms); conversion goals are refused without one.",
      "New ad sets default targeting_automation.advantage_audience to 1 (Advantage+ audience on); pass advantageAudience: false to send 0.",
      "Connector mode: before any change through Meta's Ads connector, run policy check, create everything PAUSED, stay at or under the budget cap, get the owner's yes, then log the change with audit log-external.",
    ],
    adSetDefaults: {
      promotedObject: "pixelId + customEventType (PURCHASE, LEAD, COMPLETE_REGISTRATION, ADD_TO_CART, INITIATE_CHECKOUT, SUBSCRIBE, CONTACT) or pageId",
      advantageAudience: 1,
    },
    nextSteps: connectorMode
      ? [
          "Before any change through the Meta Ads connector, run policy check on the ad text (see docs/CONNECTOR-MODE.md).",
          `Create everything PAUSED and keep each daily budget at or under ${budgetCapStatus(environment, fileEnv).limitDollars || "the cap"}.`,
          "After each connector change, run: node src/index.js audit log-external \"<what changed>\" --ids <ids>",
        ]
      : missing.length
      ? [
          "Create or confirm a Meta Business app/system user.",
          "Add the required Meta Ads env vars to the installed agent folder’s .env file.",
          "Run doctor again, then sync account data.",
          "Draft the first campaign locally before any live create call.",
        ]
      : hasLiveFailure
        ? [
          "Review the failed live checks and verify Meta app, token, account ID, and network access.",
          "Run doctor again after resolving the connection failure.",
        ]
        : [
          "Run sync to cache account, campaigns, audiences, pixels, and insights.",
          "Create the first campaign as PAUSED.",
          "Review draft and account data before activation.",
        ],
  };
}

module.exports = {
  budgetCapStatus,
  connectionMode,
  readEnvFile,
  readinessReport,
};
