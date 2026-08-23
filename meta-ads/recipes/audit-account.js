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
  if (adSet.daily_budget !== undefined && adSet.daily_budget !== null) return Number(adSet.daily_budget);
  return null;
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

  const activeAdSets = adSets.filter((adSet) => adSet.status === "ACTIVE");
  const learningFloorCents = targetCpa === null ? null : targetCpa * 100 * 50 / 7;
  const underfundedAdSets = learningFloorCents === null
    ? []
    : adSets.filter((adSet) => budgetCents(adSet) !== null && budgetCents(adSet) < learningFloorCents);
  const adsPerAdSet = adSets.map((adSet) => ({
    id: adSet.id,
    name: adSet.name || "Unnamed",
    count: ads.filter((ad) => ad.adset_id === adSet.id).length,
  }));
  const accountInsightRows = extractData(accountInsights7d);
  const frequency = accountInsightRows[0]?.frequency ?? null;
  const recommendations = [];

  if (campaigns.length > 4 || adSets.length > 8) {
    recommendations.push("Consolidate only where objectives, exclusions, events, budget controls, or test questions are not materially distinct. Rule: MEDIA-BUYER-DOCTRINE account-structure consolidation doctrine.");
  }
  if (targetCpa !== null && underfundedAdSets.length) {
    recommendations.push("Move the optimisation event one truthful step shallower or consolidate budget before changing bids. Rule: DIAGNOSIS-PLAYBOOK section 3, target CPA x 50 / 7 learning budget.");
  }
  if (frequency !== null && Number(frequency) > 3) {
    recommendations.push("Inspect fresh creative concepts and the full delivery context before calling this fatigue. Rule: DIAGNOSIS-PLAYBOOK section 4, cold frequency above 3.0.");
  }
  if (!recommendations.length) {
    recommendations.push("No account-level doctrine rule fired from the available platform data. Reconcile the selected event with CRM, checkout, and operating capacity before a live change. Rule: DIAGNOSIS-PLAYBOOK sections 1 and 2.");
  }

  const structureFinding = `${campaigns.length} campaigns and ${adSets.length} ad sets found. ${campaigns.length > 4 || adSets.length > 8 ? "Fragmentation risk is elevated against the consolidation doctrine." : "Counts do not exceed the doctrine reference range, but material distinctions still need review."}`;
  const creativeFinding = ads.length
    ? `${ads.length} ads found. Ad counts by ad set: ${adsPerAdSet.map((item) => `${item.name} (${item.count})`).join(", ")}. ${frequency === null ? "Frequency was unavailable." : `7-day account frequency: ${Number(frequency).toFixed(2)}.`}`
    : "Ad volume could not be checked because no ad data was returned.";
  const learningFinding = targetCpa === null
    ? "Spend-versus-learning math could not be calculated because targetCpa was not supplied."
    : `Learning floor: $${(learningFloorCents / 100).toFixed(2)}/day per ad set (target CPA $${targetCpa.toFixed(2)} x 50 / 7). ${underfundedAdSets.length ? `${underfundedAdSets.length} ad set(s) are below that floor based on listed daily budgets.` : "No listed ad set budget was below that floor."}`;

  return {
    status: skippedChecks.length ? "partial" : "ok",
    reply: [
      "Meta Ads account audit",
      "", "Structure findings", `- ${structureFinding}`,
      "", "Creative findings", `- ${creativeFinding}`,
      "", "Spend-versus-learning math", `- ${learningFinding}`,
      "", "Recommendations", ...recommendations.map((recommendation) => `- ${recommendation}`),
      "", "Skipped checks", ...(skippedChecks.length ? skippedChecks.map((check) => `- ${check}`) : ["- None"]),
    ].join("\n"),
    metadata: {
      campaigns,
      adSets,
      ads,
      pixels,
      activeCampaignCount: campaigns.filter((campaign) => campaign.status === "ACTIVE").length,
      activeAdSetCount: activeAdSets.length,
      adsPerAdSet,
      targetCpa,
      learningFloorCents,
      underfundedAdSetIds: underfundedAdSets.map((adSet) => adSet.id),
      accountInsights: { last7d: extractData(accountInsights7d), last28d: extractData(accountInsights28d) },
      campaignInsights,
      pixelStats,
      skippedChecks,
    },
  };
};
