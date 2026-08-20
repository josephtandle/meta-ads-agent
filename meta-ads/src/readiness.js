const fs = require("fs");
const path = require("path");
const config = require("../config/config.json");

const ENV_PATH = path.join(__dirname, "../.env");

function readEnvFile() {
  if (!fs.existsSync(ENV_PATH)) return {};

  const env = {};
  const lines = fs.readFileSync(ENV_PATH, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;

    const key = trimmed.slice(0, eq).trim();
    const rawValue = trimmed.slice(eq + 1).trim();
    env[key] = rawValue.replace(/^['"]|['"]$/g, "");
  }
  return env;
}

function envStatus() {
  const fileEnv = readEnvFile();
  const required = config.requiredEnvVars || [];

  return required.map((name) => ({
    name,
    present: Boolean(process.env[name] || fileEnv[name]),
    source: process.env[name] ? "process" : fileEnv[name] ? ENV_PATH : null,
  }));
}

function readinessReport() {
  const vars = envStatus();
  const missing = vars.filter((item) => !item.present).map((item) => item.name);
  const fileEnv = readEnvFile();

  return {
    agent: "meta-ads",
    status: missing.length === 0 ? "ready_for_live_api" : "offline_copilot_only",
    apiVersion: config.apiVersion,
    env: vars,
    optionalSettings: (config.optionalEnvVars || []).map((name) => ({
      name,
      present: Boolean(process.env[name] || fileEnv[name]),
      source: process.env[name] ? "process" : fileEnv[name] ? ENV_PATH : null,
    })),
    missing,
    enabledNow: [
      "offline campaign drafts",
      "paused-by-default launch plans",
      "setup/readiness checks",
      "local JSON draft archive",
    ],
    blockedUntilCredentials: [
      "account lookup",
      "campaign sync",
      "audience/pixel listing",
      "live campaign/ad set/ad creation",
      "performance reporting",
    ],
    guardrails: [
      "Campaign, ad set, and ad drafts remain PAUSED by default.",
      "Activation requires the account owner's explicit approval.",
      "Budget increases require the account owner's explicit approval.",
      "No live API writes run until Meta credentials are present.",
    ],
    nextSteps: missing.length
      ? [
          "Create or confirm a Meta Business app/system user.",
          "Add the required Meta Ads env vars to the agent's local .env file.",
          "Run doctor again, then sync account data.",
          "Draft the first campaign locally before any live create call.",
        ]
      : [
          "Run sync to cache account, campaigns, audiences, pixels, and insights.",
          "Create the first campaign as PAUSED.",
          "Review draft and account data before activation.",
        ],
  };
}

module.exports = {
  readinessReport,
};
