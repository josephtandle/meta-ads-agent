const api = require("../src/api-client");
const policy = require("../src/policy-check");
const { readArg } = require("../src/recipe-helpers");

module.exports.runRecipe = async function runRecipe(input = {}) {
  const args = input.args || input;
  const rawSpec = input.spec || args.spec || args;
  const dryRun = Object.prototype.hasOwnProperty.call(input, "dryRun")
    ? input.dryRun !== false
    : readArg(input, "dryRun", true) !== false;
  const policyOverride = input.policyOverride !== undefined ? input.policyOverride : readArg(input, "policyOverride", undefined);
  const spec = rawSpec && typeof rawSpec === "object" && Object.prototype.hasOwnProperty.call(rawSpec, "policyOverride")
    ? Object.fromEntries(Object.entries(rawSpec).filter(([key]) => key !== "policyOverride"))
    : rawSpec;
  // Meta policy check first. A BLOCK throws with the findings and rewrites
  // unless policyOverride holds a reason, which is written to the audit log.
  const policyReport = policy.enforcePolicy({ action: "creatives carousel (recipe)", input: spec, override: policyOverride, dryRun });
  const metadata = await api.createCarouselCreative(spec, dryRun);
  metadata.policyCheck = { status: policyReport.status, ruleIds: [...new Set(policyReport.findings.map((f) => f.ruleId))], ...(policyReport.overridden ? { overrideReason: policyReport.overrideReason } : {}) };
  return {
    status: metadata.dryRun ? "dry_run" : "ok",
    reply: metadata.dryRun
      ? `Carousel creative dry run prepared for ${metadata.summary.cardCount} cards.`
      : `Created carousel creative ${metadata.creativeId}. No ad was created.`,
    metadata,
  };
};
