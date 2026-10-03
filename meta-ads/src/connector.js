"use strict";

/**
 * Connector mode helpers.
 *
 * When Claude creates or edits ads through Meta's official Ads connector, this
 * agent does not make the call, so its write paths never log anything. These
 * helpers keep the audit log complete anyway:
 *
 *   audit log-external "<what changed>" [--ids a,b] [--source connector]
 *   audit tail [n]
 *
 * Nothing here talks to Meta. Every line is redacted before it is written or
 * printed.
 */

const fs = require("fs");
const path = require("path");
const { writeAudit } = require("./audit-log");
const { redactString, redactValue, REDACTED } = require("./redact");

const MAX_SUMMARY_LENGTH = 2000;
const DEFAULT_TAIL = 20;
const MAX_TAIL = 500;
// Meta user and system user tokens start with EAA. In connector mode there is
// no token in the environment to match against, so catch the shape instead.
const TOKEN_SHAPE = /\bEAA[A-Za-z0-9]{20,}\b/g;

function auditPath() {
  return process.env.META_ADS_AUDIT_LOG_PATH || path.join(__dirname, "../data/audit.jsonl");
}

function scrub(text) {
  return redactString(String(text)).replace(TOKEN_SHAPE, REDACTED);
}

function scrubValue(value) {
  const redacted = redactValue(value);
  if (typeof redacted === "string") return scrub(redacted);
  if (Array.isArray(redacted)) return redacted.map(scrubValue);
  if (redacted && typeof redacted === "object") {
    return Object.fromEntries(Object.entries(redacted).map(([key, item]) => [key, scrubValue(item)]));
  }
  return redacted;
}

function takeOption(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  args.splice(index, value === undefined ? 1 : 2);
  return value;
}

function parseIds(raw) {
  if (raw === undefined || raw === null) return [];
  return String(raw).split(",").map((id) => scrub(id.trim())).filter(Boolean);
}

// Appends one line to the same audit log the write paths use. Never calls Meta.
function logExternal({ summary, ids = [], source = "connector" } = {}) {
  const text = scrub(String(summary || "").trim());
  if (!text) throw new Error("Usage: audit log-external \"<what changed, ids if known>\" [--ids a,b] [--source connector]");
  if (text.length > MAX_SUMMARY_LENGTH) throw new Error(`audit log-external: keep the summary under ${MAX_SUMMARY_LENGTH} characters.`);
  const cleanSource = scrub(String(source || "connector").trim()).slice(0, 40) || "connector";
  const cleanIds = Array.isArray(ids) ? ids.map((id) => scrub(String(id).trim())).filter(Boolean) : parseIds(ids);
  writeAudit(
    `EXTERNAL CHANGE (${cleanSource})`,
    { summary: text, ids: cleanIds, source: cleanSource },
    { external: true, sentByThisAgent: false },
    { source: cleanSource },
  );
  return { logged: true, source: cleanSource, ids: cleanIds, summary: text, auditLog: auditPath() };
}

// Last n audit lines, parsed and redacted. Unparseable lines are redacted text.
function tailAudit(n = DEFAULT_TAIL) {
  const count = Math.min(Math.max(Number.parseInt(n, 10) || DEFAULT_TAIL, 1), MAX_TAIL);
  let raw;
  try {
    raw = fs.readFileSync(auditPath(), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  return raw.split("\n").filter((line) => line.trim()).slice(-count).map((line) => {
    try {
      return scrubValue(JSON.parse(line));
    } catch {
      return scrub(line);
    }
  });
}

function runAuditCommand(sub, rest) {
  const args = rest.slice();
  switch (sub) {
    case "log-external": {
      const ids = takeOption(args, "--ids");
      const source = takeOption(args, "--source");
      const result = logExternal({ summary: args.join(" "), ids: parseIds(ids), source });
      console.log(`Logged to the audit log (source: ${result.source}${result.ids.length ? `, ids: ${result.ids.join(", ")}` : ""}). Nothing was sent to Meta.`);
      return result;
    }
    case "tail": {
      const lines = tailAudit(args[0]);
      if (!lines.length) console.log("No audit entries yet.");
      for (const line of lines) console.log(typeof line === "string" ? line : JSON.stringify(line));
      return lines;
    }
    default:
      throw new Error("Usage: audit log-external \"<what changed>\" [--ids a,b] [--source connector] | audit tail [n]");
  }
}

module.exports = {
  logExternal,
  parseIds,
  runAuditCommand,
  scrub,
  tailAudit,
};
