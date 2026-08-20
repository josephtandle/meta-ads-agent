const api = require("../src/api-client");
const {
  buildListResponse,
  extractData,
  summarizeCampaign,
} = require("../src/recipe-helpers");

module.exports.runRecipe = async function runRecipe() {
  const campaignsResponse = await api.listCampaigns();
  const campaigns = extractData(campaignsResponse).map(summarizeCampaign);

  return buildListResponse({
    title: "Meta Ads campaigns",
    emptyMessage: "No Meta Ads campaigns were found.",
    items: campaigns,
    metadataKey: "campaigns",
    renderRow: (campaign) => {
      const budget = campaign.dailyBudget || campaign.lifetimeBudget || "no budget";
      return `${campaign.name || "Unnamed"} | ${campaign.status || "unknown"} | ${campaign.objective || "unknown"} | ${budget}`;
    },
  });
};
