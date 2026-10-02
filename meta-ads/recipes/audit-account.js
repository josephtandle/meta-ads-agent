const api = require("../src/api-client");
const { extractData, readArg } = require("../src/recipe-helpers");

async function readCheck(label, check, skippedChecks) {
  try {
    return await check();
  } catch (error) {
    skippedChecks.push(`${label}: ${error.message}`);
    return null;
  }
}

function positiveNumberOrNull(input, name) {
  const value = readArg(input, name, null);
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function budgetCents(adSet) {
  const value = Number(adSet.daily_budget);
  return Number.isFinite(value) && value > 0 ? value : null;
}

module.exports.runRecipe = async function runRecipe(input = {}) {
  const skippedChecks = [];
  const targetCpa = positiveNumberOrNull(input, "targetCpa");
  const campaignsResponse = await readCheck("campaign list", () => api.listCampaigns(), skippedChecks);
  const campaigns = extractData(campaignsResponse);
  const adSetsResponse = await readCheck("ad set list", () => api.listAdSets(), skippedChecks);
  const adSets = extractData(adSetsResponse);
  const adsResponse = await readCheck(
    "ad list",
    () => api.listAds(null, "id,name,status,adset_id,creative{id,title,body,image_url,thumbnail_url}"),
    skippedChecks,
  );
  const ads = extractData(adsResponse);
  const accountInsights7d = await readCheck("account insights (7d)", () => api.getAccountInsights("last_7d"), skippedChecks);
  const accountInsights28d = await readCheck("account insights (28d)", () => api.getAccountInsights("last_28d"), skippedChecks);

  const campaignInsights = {};
  if (!campaignsResponse) skippedChecks.push("campaign insights (7d and 28d): skipped because the campaign list was unavailable");
  for (const campaign of campaigns) {
    campaignInsights[campaign.id] = {
      last7d: await readCheck(`campaign insights 7d (${campaign.id})`, () => api.getCampaignInsights(campaign.id, "last_7d"), skippedChecks),
      last28d: await readCheck(`campaign insights 28d (${campaign.id})`, () => api.getCampaignInsights(campaign.id, "last_28d"), skippedChecks),
    };
  }

  const pixelsResponse = await readCheck("pixel list", () => api.listPixels(), skippedChecks);
  const pixels = extractData(pixelsResponse);
  const pixelStats = {};
  if (!pixelsResponse) skippedChecks.push("pixel stats: skipped because the pixel list was unavailable");
  for (const pixel of pixels) {
    pixelStats[pixel.id] = await readCheck(`pixel stats (${pixel.id})`, () => api.getPixelStats(pixel.id, "last_28d"), skippedChecks);
  }

  const activeCampaigns = campaigns.filter((campaign) => (campaign.effective_status || campaign.status) === "ACTIVE");
  const activeAdSets = adSets.filter((adSet) => {
    if ((adSet.effective_status || adSet.status) !== "ACTIVE") return false;
    const parent = campaigns.find((campaign) => campaign.id === adSet.campaign_id);
    return !parent || (parent.effective_status || parent.status) === "ACTIVE";
  });
  const learningFloorCents = targetCpa === null ? null : targetCpa * 100 * 50 / 7;
  const evaluableAdSets = activeAdSets.filter((adSet) => budgetCents(adSet) !== null);
  const unavailableBudgetCount = activeAdSets.length - evaluableAdSets.length;
  const underfundedAdSets = learningFloorCents === null
    ? []
    : evaluableAdSets.filter((adSet) => budgetCents(adSet) < learningFloorCents);
  const adsPerAdSet = adSets.map((adSet) => ({
    id: adSet.id,
    name: adSet.name || "Unnamed",
    count: ads.filter((ad) => ad.adset_id === adSet.id).length,
  }));
  const accountInsightRows = extractData(accountInsights7d);
  const frequency = accountInsightRows[0]?.frequency ?? null;
  const recommendations = [];

  if (campaignsResponse && adSetsResponse && (activeCampaigns.length > 4 || activeAdSets.length > 8)) {
    recommendations.push("Consolidate only where objectives, exclusions, events, budget controls, or test questions are not materially distinct. Rule: MEDIA-BUYER-DOCTRINE account-structure consolidation doctrine.");
  }
  if (targetCpa !== null && underfundedAdSets.length) {
    recommendations.push("Move the optimisation event one truthful step shallower or consolidate budget before changing bids. Rule: DIAGNOSIS-PLAYBOOK section 3, target CPA x 50 / 7 learning budget.");
  }
  if (!recommendations.length) {
    recommendations.push(skippedChecks.length
      ? "Audit inputs are incomplete, so no account-level doctrine conclusion can be made. Re-run the failed checks before a live change."
      : "No account-level doctrine rule fired from the available platform data. Reconcile the selected event with CRM, checkout, and operating capacity before a live change. Rule: DIAGNOSIS-PLAYBOOK sections 1 and 2.");
  }

  const structureFinding = !campaignsResponse || !adSetsResponse
    ? "Account structure is unknown because campaign or ad set inventory could not be read."
    : `${campaigns.length} campaigns and ${adSets.length} ad sets found, including ${activeCampaigns.length} active campaigns and ${activeAdSets.length} active ad sets. ${activeCampaigns.length > 4 || activeAdSets.length > 8 ? "Fragmentation risk is elevated against the consolidation doctrine." : "Active counts do not exceed the doctrine reference range, but material distinctions still need review."}`;
  const creativeFinding = !adsResponse
    ? "Creative inventory is unknown because ad data could not be read."
    : ads.length
    ? `${ads.length} ads found. Ad counts by ad set: ${adsPerAdSet.map((item) => `${item.name} (${item.count})`).join(", ")}. ${frequency === null ? "Frequency was unavailable." : `7-day account frequency: ${Number(frequency).toFixed(2)}.`}`
    : "No ads were returned.";
  const learningFinding = !adSetsResponse
    ? "Spend-versus-learning math is unknown because ad set inventory could not be read."
    : targetCpa === null
    ? "Spend-versus-learning math could not be calculated because targetCpa was not supplied."
    : !activeAdSets.length
    ? "No active ad sets were returned, so learning-budget adequacy is not assessed."
    : !evaluableAdSets.length
    ? "Learning-budget adequacy cannot be assessed: active ad sets have no usable daily budgets. Check campaign-level or lifetime budgets."
    : `Reference learning floor: $${(learningFloorCents / 100).toFixed(2)}/day per active ad set (target CPA $${targetCpa.toFixed(2)} x 50 / 7). ${underfundedAdSets.length ? `${underfundedAdSets.length} active ad set(s) are below that reference based on listed daily budgets.` : "No evaluated active ad set daily budget was below that reference."} ${unavailableBudgetCount ? `Budget adequacy cannot be determined for ${unavailableBudgetCount} other active ad set(s); inspect campaign-level or lifetime budgets.` : ""}`.trim();

  const frequencyNote = frequency === null
    ? "Frequency was unavailable."
    : `7-day account-wide frequency: ${Number(frequency).toFixed(2)}. Account-wide frequency cannot establish cold-audience fatigue without audience-level delivery evidence.`;

  return {
    status: skippedChecks.length ? "partial" : "ok",
    reply: [
      "Meta Ads account audit",
      "", "Structure findings", `- ${structureFinding}`,
      "", "Creative findings", `- ${creativeFinding}`, `- ${frequencyNote}`,
      "", "Spend-versus-learning math", `- ${learningFinding}`,
      "", "Recommendations", ...recommendations.map((recommendation) => `- ${recommendation}`),
      "", "Skipped checks", ...(skippedChecks.length ? skippedChecks.map((check) => `- ${check}`) : ["- None"]),
    ].join("\n"),
    metadata: {
      campaigns,
      adSets,
      ads,
      pixels,
      activeCampaignCount: activeCampaigns.length,
      activeAdSetCount: activeAdSets.length,
      adsPerAdSet,
      targetCpa,
      learningFloorCents,
      underfundedAdSetIds: underfundedAdSets.map((adSet) => adSet.id),
      evaluatedBudgetCount: evaluableAdSets.length,
      unavailableBudgetCount,
      accountInsights: { last7d: extractData(accountInsights7d), last28d: extractData(accountInsights28d) },
      campaignInsights,
      pixelStats,
      skippedChecks,
    },
  };
};
