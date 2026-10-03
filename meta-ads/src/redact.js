"use strict";

/**
 * Credential redaction for everything that leaves the API client.
 *
 * Graph API responses carry the caller's access token inside paging URLs
 * (paging.next / paging.previous) and sometimes inside error messages. The
 * CLI prints responses raw, so without this step the token lands in the
 * terminal, in chat transcripts, in the audit log and in the data/ cache.
 *
 * Three layers, applied to every string found anywhere in a value:
 *   1. Query parameters named access_token, appsecret_proof or client_secret
 *      lose their value (any value, configured or not).
 *   2. Every configured credential value (META_ADS_ACCESS_TOKEN,
 *      META_ADS_APP_SECRET by default; see config.secretEnvVars) is replaced
 *      wherever it appears, raw or URL-encoded. This also covers any query
 *      parameter whose value equals a credential, whatever its name.
 *   3. Object keys that are themselves credential names have their value
 *      replaced outright.
 * paging.next and paging.previous URLs are reduced to their cursor so the
 * full URL (which always contains the token) never reaches an output.
 */

const config = require("../config/config.json");

const REDACTED = "<redacted>";
const CREDENTIAL_PARAMS = ["access_token", "appsecret_proof", "client_secret"];
const CREDENTIAL_KEYS = new Set([...CREDENTIAL_PARAMS, "app_secret", "appsecret"]);
const DEFAULT_SECRET_ENV_VARS = ["META_ADS_ACCESS_TOKEN", "META_ADS_APP_SECRET"];
const MIN_SECRET_LENGTH = 4;
const PARAM_PATTERN = new RegExp(`(^|[?&\\s'"])(${CREDENTIAL_PARAMS.join("|")})=([^&#\\s'"]*)`, "gi");

function secretEnvVarNames() {
  const names = Array.isArray(config.secretEnvVars) && config.secretEnvVars.length
    ? config.secretEnvVars
    : DEFAULT_SECRET_ENV_VARS;
  return names;
}

// Read lazily so tests (and the CLI) that set env after module load still get
// the right values. Short values are ignored: a one-character "secret" would
// otherwise blank every matching letter in the output.
function credentialValues(environment = process.env) {
  const values = new Set();
  for (const name of secretEnvVarNames()) {
    const raw = environment[name];
    if (typeof raw !== "string") continue;
    const value = raw.trim();
    if (value.length < MIN_SECRET_LENGTH) continue;
    values.add(value);
    const encoded = encodeURIComponent(value);
    if (encoded !== value) values.add(encoded);
  }
  return [...values].sort((a, b) => b.length - a.length);
}

function redactString(input, environment = process.env) {
  if (typeof input !== "string" || !input) return input;
  let output = input.replace(PARAM_PATTERN, (_match, prefix, name) => `${prefix}${name}=${REDACTED}`);
  for (const value of credentialValues(environment)) {
    if (output.includes(value)) output = output.split(value).join(REDACTED);
  }
  return output;
}

function cursorFromPagingUrl(url, direction) {
  try {
    const parsed = new URL(url);
    const param = direction === "previous" ? "before" : "after";
    return parsed.searchParams.get(param);
  } catch {
    return null;
  }
}

function redactPagingUrl(url, direction) {
  // Idempotent: output already redacted upstream passes through unchanged.
  if (url.startsWith("<redacted url")) return url;
  const cursor = cursorFromPagingUrl(url, direction);
  const param = direction === "previous" ? "before" : "after";
  return cursor
    ? `<redacted url; next page cursor paging.cursors.${param}=${redactString(cursor)}>`
    : "<redacted url>";
}

function redactValue(value, environment = process.env, parentKey = null, seen = new WeakSet()) {
  if (typeof value === "string") return redactString(value, environment);
  if (!value || typeof value !== "object") return value;
  if (seen.has(value)) return "<circular>";
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, environment, parentKey, seen));
  }
  if (value instanceof Error) {
    return redactString(value.message, environment);
  }

  const output = {};
  for (const [key, item] of Object.entries(value)) {
    const lowerKey = key.toLowerCase();
    if (CREDENTIAL_KEYS.has(lowerKey)) {
      output[key] = REDACTED;
    } else if (parentKey === "paging" && (lowerKey === "next" || lowerKey === "previous") && typeof item === "string") {
      output[key] = redactPagingUrl(item, lowerKey);
    } else {
      output[key] = redactValue(item, environment, lowerKey, seen);
    }
  }
  return output;
}

function redactError(error, environment = process.env) {
  if (error && typeof error === "object" && typeof error.message === "string") {
    const redacted = redactString(error.message, environment);
    if (redacted !== error.message) {
      try {
        error.message = redacted;
      } catch {
        return new Error(redacted);
      }
    }
  }
  return error;
}

module.exports = {
  REDACTED,
  credentialValues,
  redactError,
  redactString,
  redactValue,
  secretEnvVarNames,
};
