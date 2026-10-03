const policy = require("../src/policy-check");
const { readArg } = require("../src/recipe-helpers");

// Read-only. Takes Meta's rejection reason (or an ad id whose cached copy has
// effective_status / ad_review_feedback), maps it to the policy rules, checks
// the ad text it can find, and drafts a fix. Nothing is sent to Meta.
module.exports.runRecipe = async function runRecipe(input = {}) {
  let reason = readArg(input, ["reason", "rejection", "feedback", "message"], "") || "";
  const adId = readArg(input, ["adId", "creativeId", "id"], null);
  const providedText = readArg(input, ["text", "creative", "spec"], null);

  let ad = null;
  let checkInput = providedText;
  if (adId) {
    const cached = policy.findCached(adId);
    if (cached) {
      ad = cached.ad;
      if (!checkInput) checkInput = cached.creative || cached.ad;
      const fromCache = policy.rejectionFromCachedAd(cached.ad);
      if (fromCache && fromCache.feedback && !String(reason).trim()) reason = fromCache.feedback;
    } else if (!checkInput && !String(reason).trim()) {
      throw new Error(`Ad ${adId} is not in the local cache. Run sync, or paste Meta's rejection reason and the ad text.`);
    }
  }
  if (!String(reason).trim() && !checkInput) throw new Error("Paste Meta's rejection reason, the ad id, or the ad text.");

  const mappedRuleIds = policy.mapRejectionReason(reason);
  const report = checkInput ? policy.checkCreative(checkInput) : null;
  const matched = report ? report.findings.filter((f) => mappedRuleIds.length === 0 || mappedRuleIds.includes(f.ruleId)) : [];
  const findings = matched.length ? matched : (report ? report.findings : []);
  const rules = policy.listRules();
  const ruleById = Object.fromEntries(policy.loadRules().all.map((rule) => [rule.id, rule]));

  const lines = [];
  lines.push(reason ? `Meta said: ${String(reason).trim()}` : "No rejection reason given; checking the ad text only.");
  if (ad && ad.effective_status) lines.push(`Ad status in the last sync: ${ad.effective_status}.`);
  if (mappedRuleIds.length) lines.push(`That points to: ${mappedRuleIds.join(", ")}.`);
  else if (reason) lines.push("The reason did not match a known rule. The ad text check below is the best lead.");
  if (findings.length) {
    lines.push("", "What to change:");
    for (const f of findings) lines.push(`- ${f.level} ${f.ruleId}: "${f.phrase}". ${f.rewrite}`);
  } else if (mappedRuleIds.length) {
    lines.push("", "The text the agent can see does not trip these rules, so look at the image, video and landing page:");
    for (const id of mappedRuleIds.slice(0, 5)) if (ruleById[id]) lines.push(`- ${id}: ${ruleById[id].explain} ${ruleById[id].rewrite}`);
  }
  lines.push("", "Then: make the edits, run the policy check again, and create a new ad (paused). If you believe the rejection is wrong, request a review in Account Quality.");

  return {
    status: "ok",
    reply: lines.join("\n"),
    metadata: {
      reason: String(reason).trim() || null,
      adId: adId || null,
      effectiveStatus: ad ? ad.effective_status || null : null,
      mappedRuleIds,
      findings,
      check: report,
      knownRules: rules.length,
    },
  };
};
