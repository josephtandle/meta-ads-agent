const policy = require("../src/policy-check");
const { readArg } = require("../src/recipe-helpers");

// Read-only. Checks ad text against Meta's Advertising Standards using the
// rules in policies/rules.json. Never writes, never calls a write endpoint.
// Input (args): text, or creative (object), or spec (carousel / handoff),
// or file (path to JSON), or creativeId / adId (local cache first).
module.exports.runRecipe = async function runRecipe(input = {}) {
  const creative = readArg(input, ["creative", "spec", "handoff"], null);
  const target = readArg(input, ["text", "file", "path", "creativeId", "adId", "id"], null);
  let resolved;
  if (creative && typeof creative === "object") resolved = { input: creative, source: "creative object" };
  else if (target !== null && target !== undefined && String(target).trim()) resolved = await policy.resolvePolicyInput(String(target));
  else throw new Error("Give me the ad text, a creative, a file path or a creative id to check.");

  const report = policy.checkCreative(resolved.input);
  const reply = report.status === "PASS"
    ? `PASS: nothing in this ad breaks Meta's rules that the agent knows (${report.fieldsChecked.length} text fields checked).`
    : policy.formatReport(report, { title: "Meta policy check" });
  return {
    status: report.status === "PASS" ? "ok" : report.status === "WARN" ? "warn" : "blocked",
    reply,
    metadata: { source: resolved.source, ...report },
  };
};
