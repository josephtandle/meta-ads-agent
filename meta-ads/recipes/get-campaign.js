const api = require("../src/api-client");
const {
  extractData,
  firstDataRow,
  formatCurrency,
  requireTextArg,
  summarizeCampaign,
  summarizeInsight,
} = require("../src/recipe-helpers");

module.exports.runRecipe = async function runRecipe(input = {}) {
  const campaignId = requireTextArg(input, ["campaignId", "id"], "campaignId");
  const campaign = await api.getCampaign(campaignId);
  const insightsRow = firstDataRow(extractData(campaign?.insights || []));
  const summary = summarizeCampaign(campaign);

  return {
    status: "ok",
    reply: [
      `Meta Ads campaign ${summary.name || "Unnamed"} (${summary.id || campaignId})`,
      `- Status: ${summary.status || "unknown"}`,
      `- Objective: ${summary.objective || "unknown"}`,
      `- Daily budget: ${summary.dailyBudget || "n/a"}`,
      `- Lifetime budget: ${summary.lifetimeBudget || "n/a"}`,
      insightsRow ? `- Spend: ${formatCurrency(insightsRow.spend || 0)} | Clicks: ${insightsRow.clicks || 0} | Impressions: ${insightsRow.impressions || 0}` : "- No insights returned",
    ].join("\n"),
    metadata: {
      campaignId,
      campaign: summary,
      insights: insightsRow ? summarizeInsight(insightsRow) : null,
    },
  };
};
