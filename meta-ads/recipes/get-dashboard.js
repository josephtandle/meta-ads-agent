const api = require("../src/api-client");
const {
  extractData,
  firstDataRow,
  formatCurrency,
  formatCurrencyFromCents,
  formatDecimal,
  formatInteger,
  formatPercent,
  normalizeTimeRange,
  summarizeAccount,
  summarizeCampaign,
  summarizeInsight,
} = require("../src/recipe-helpers");

module.exports.runRecipe = async function runRecipe(input = {}) {
  const timeRange = normalizeTimeRange(input);
  const [account, insightsResponse, campaignsResponse] = await Promise.all([
    api.getAccountInfo(),
    api.getAccountInsights(timeRange),
    api.listCampaigns(),
  ]);

  const campaigns = extractData(campaignsResponse).map(summarizeCampaign);
  const accountInsights = firstDataRow(insightsResponse);
  const activeCount = campaigns.filter((campaign) => String(campaign.status || "").toUpperCase() === "ACTIVE").length;
  const pausedCount = campaigns.filter((campaign) => String(campaign.status || "").toUpperCase() === "PAUSED").length;

  const reply = [
    `Meta Ads dashboard for ${account?.name || "unknown account"} (${account?.id || "unknown"})`,
    `- Spend: ${formatCurrency(accountInsights?.spend || 0)}`,
    `- Impressions: ${formatInteger(accountInsights?.impressions || 0)}`,
    `- Reach: ${formatInteger(accountInsights?.reach || 0)}`,
    `- Clicks: ${formatInteger(accountInsights?.clicks || 0)}`,
    `- CTR: ${formatPercent(accountInsights?.ctr || 0)}`,
    `- CPC: ${formatCurrency(accountInsights?.cpc || 0)}`,
    `- CPM: ${formatCurrency(accountInsights?.cpm || 0)}`,
    `- Frequency: ${formatDecimal(accountInsights?.frequency || 0)}`,
    `- Campaigns: ${campaigns.length} total (${activeCount} active, ${pausedCount} paused)`,
  ];

  if (campaigns.length > 0) {
    reply.push("- Top campaigns:");
    for (const campaign of campaigns.slice(0, 5)) {
      const budget = campaign.dailyBudget || campaign.lifetimeBudget || "no budget";
      reply.push(`  - ${campaign.name || "Unnamed"} | ${campaign.status || "unknown"} | ${campaign.objective || "unknown"} | ${budget}`);
    }
  }

  return {
    status: "ok",
    reply: reply.join("\n"),
    metadata: {
      timeRange,
      account: summarizeAccount(account),
      insights: accountInsights ? summarizeInsight(accountInsights) : null,
      campaigns,
    },
  };
};
