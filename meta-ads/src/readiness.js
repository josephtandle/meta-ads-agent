const fs = require("fs");
const path = require("path");
const config = require("../config/config.json");
const api = require("./api-client");

const ENV_PATH = path.join(__dirname, "../.env");
const ENV_PATHS = [ENV_PATH];

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

  try {
    const account = await apiClient.apiCall(`/${accountId}`, "GET", null, {
      fields: "name,account_status",
    }, { timeoutMs });
    if (!String(account.id || accountId).startsWith("act_")) {
      checks.push(liveCheck("account_connection", "fail", "Meta returned an account ID that is not in act_ format."));
    } else {
      checks.push(liveCheck("account_connection", "pass", `Connected to ${account.name || accountId} (status ${account.account_status ?? "unknown"}).`));
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

  return checks;
}

async function readinessReport({ environment = process.env, fileEnv = readEnvFile(), apiClient = api } = {}) {
  const vars = envStatus(environment, fileEnv);
  const missing = vars.filter((item) => !item.present).map((item) => item.name);
  const credential = (name) => environment[name] || fileEnv[name];
  const liveChecks = missing.length
    ? [
        liveCheck("account_connection", "skipped", "Credentials are incomplete, live API checks skipped."),
        liveCheck("app_id", "skipped", "Credentials are incomplete, live API checks skipped."),
        liveCheck("account_details", "skipped", "Credentials are incomplete, live API checks skipped."),
      ]
    : await runLiveChecks(apiClient, credential("META_ADS_ACCOUNT_ID"), credential("META_ADS_APP_ID"));
  const hasLiveFailure = liveChecks.some((check) => check.status === "fail");

  return {
    agent: "meta-ads",
    status: missing.length
      ? "offline_copilot_only"
      : hasLiveFailure ? "connection_check_failed" : "ready_for_live_api",
    apiVersion: config.apiVersion,
    env: vars,
    liveChecks,
    optionalSettings: (config.optionalEnvVars || []).map((name) => ({
      name,
      present: Boolean(environment[name] || fileEnv[name]),
      source: environment[name] ? "process" : fileEnv[name] ? "agent .env or workspace fallback" : null,
    })),
    missing,
    enabledNow: [
      "offline campaign drafts",
      "paused-by-default launch plans",
      "setup/readiness checks",
      "local JSON draft archive",
      "carousel creative previews (dry run)",
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
    ],
    nextSteps: missing.length
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
  readEnvFile,
  readinessReport,
};
