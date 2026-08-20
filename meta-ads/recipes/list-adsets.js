const api = require("../src/api-client");
const {
  buildListResponse,
  extractData,
  readArg,
  summarizeAdSet,
} = require("../src/recipe-helpers");

module.exports.runRecipe = async function runRecipe(input = {}) {
  const campaignId = readArg(input, ["campaignId", "campaign_id", "id"], null);
  const adSetsResponse = await api.listAdSets(campaignId || null);
  const adSets = extractData(adSetsResponse).map(summarizeAdSet);

  return buildListResponse({
    title: "Meta Ads ad sets",
    emptyMessage: "No Meta Ads ad sets were found.",
    items: adSets,
    metadataKey: "adSets",
    renderRow: (adSet) => {
      const budget = adSet.dailyBudget || adSet.lifetimeBudget || "no budget";
      return `${adSet.name || "Unnamed"} | ${adSet.status || "unknown"} | ${budget}`;
    },
  });
};
