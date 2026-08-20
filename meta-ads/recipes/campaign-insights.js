const api = require("../src/api-client");
const {
  extractData,
  firstDataRow,
  formatCurrency,
  formatDecimal,
  formatInteger,
  formatPercent,
  normalizeTimeRange,
  requireTextArg,
  summarizeInsight,
} = require("../src/recipe-helpers");

module.exports.runRecipe = async function runRecipe(input = {}) {
  const campaignId = requireTextArg(input, ["campaignId", "id"], "campaignId");
  const timeRange = normalizeTimeRange(input);
  const insightsResponse = await api.getCampaignInsights(campaignId, timeRange);
  const insight = firstDataRow(extractData(insightsResponse));

  if (!insight) {
    return {
      status: "skipped",
      reply: `No Meta Ads campaign insights were returned for ${campaignId} (${timeRange}).`,
      metadata: {
        campaignId,
        timeRange,
        insights: [],
      },
    };
  }

  return {
    status: "ok",
    reply: [
      `Meta Ads campaign insights for ${campaignId} (${timeRange})`,
      `- Spend: ${formatCurrency(insight.spend || 0)}`,
      `- Impressions: ${formatInteger(insight.impressions || 0)}`,
      `- Reach: ${formatInteger(insight.reach || 0)}`,
      `- Clicks: ${formatInteger(insight.clicks || 0)}`,
      `- CTR: ${formatPercent(insight.ctr || 0)}`,
      `- CPC: ${formatCurrency(insight.cpc || 0)}`,
      `- CPM: ${formatCurrency(insight.cpm || 0)}`,
      `- ROAS: ${formatDecimal(insight.purchase_roas || 0)}`,
    ].join("\n"),
    metadata: {
      campaignId,
      timeRange,
      insight: summarizeInsight(insight),
    },
  };
};
