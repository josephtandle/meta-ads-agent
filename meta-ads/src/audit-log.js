const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ACCOUNT_ID = process.env.META_ADS_ACCOUNT_ID;
const SECRET_KEYS = new Set(["access_token", "app_secret"]);

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== "object") return value;

  const sanitized = Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !SECRET_KEYS.has(key.toLowerCase()))
      .map(([key, item]) => [key, key.toLowerCase() === "bytes" && typeof item === "string"
        ? `<base64 ${item.length} chars>`
        : sanitize(item)]),
  );
  if (typeof value.bytes === "string") {
    const bytes = Buffer.from(value.bytes, "base64");
    sanitized.byteSize = bytes.length;
    sanitized.sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
  }
  return sanitized;
}

function writeAudit(action, request, result) {
  const auditPath = process.env.META_ADS_AUDIT_LOG_PATH
    || path.join(__dirname, "../data/audit.jsonl");
  fs.mkdirSync(path.dirname(auditPath), { recursive: true });
  fs.appendFileSync(auditPath, `${JSON.stringify({
    timestamp: new Date().toISOString(),
    action,
    accountId: ACCOUNT_ID,
    request: sanitize(request),
    result: sanitize(result),
  })}\n`);
}

module.exports = { sanitize, writeAudit };
