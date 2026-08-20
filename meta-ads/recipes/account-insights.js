const api = require("../src/api-client");
const {
  extractData,
  firstDataRow,
  formatCurrency,
  formatDecimal,
  formatInteger,
  formatPercent,
  normalizeTimeRange,
  summarizeInsight,
} = require("../src/recipe-helpers");

module.exports.runRecipe = async function runRecipe(input = {}) {
  const timeRange = normalizeTimeRange(input);
  const insightsResponse = await api.getAccountInsights(timeRange);
  const insight = firstDataRow(extractData(insightsResponse));

  if (!insight) {
    return {
      status: "skipped",
      reply: `No Meta Ads account insights were returned for ${timeRange}.`,
      metadata: {
        timeRange,
        insights: [],
      },
    };
  }

  return {
    status: "ok",
    reply: [
      `Meta Ads account insights (${timeRange})`,
      `- Spend: ${formatCurrency(insight.spend || 0)}`,
      `- Impressions: ${formatInteger(insight.impressions || 0)}`,
      `- Reach: ${formatInteger(insight.reach || 0)}`,
      `- Clicks: ${formatInteger(insight.clicks || 0)}`,
      `- CTR: ${formatPercent(insight.ctr || 0)}`,
      `- CPC: ${formatCurrency(insight.cpc || 0)}`,
      `- CPM: ${formatCurrency(insight.cpm || 0)}`,
      `- Frequency: ${formatDecimal(insight.frequency || 0)}`,
    ].join("\n"),
    metadata: {
      timeRange,
      insight: summarizeInsight(insight),
    },
  };
};
