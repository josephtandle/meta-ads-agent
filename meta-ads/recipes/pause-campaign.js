const api = require("../src/api-client");
const { readArg, requireTextArg, summarizeCampaign, extractData, firstDataRow, formatCurrency } = require("../src/recipe-helpers");

module.exports.runRecipe = async function runRecipe(input = {}) {
  const campaignId = requireTextArg(input, ["campaignId", "id"], "campaignId");
  const requiredConfirmation = `CONFIRM PAUSE ${campaignId}`;

  // Always look up the real campaign before deciding anything. The blocked
  // response below is the only thing an unconfirmed caller ever sees, so it
  // must carry what is actually about to change: name, status, and spend so
  // far. Never invent or omit this on the strength of a report already run.
  const campaign = await api.getCampaign(campaignId);
  const summary = summarizeCampaign(campaign);
  const insightsRow = firstDataRow(extractData(campaign?.insights || []));
  const spend = insightsRow ? formatCurrency(insightsRow.spend || 0) : "N/A";

  if (readArg(input, ["confirmation"]) !== requiredConfirmation) {
    return {
      status: "blocked",
      reply: [
        `About to pause a LIVE Meta Ads campaign. This stops ad delivery immediately.`,
        `- Campaign: ${summary.name || "Unnamed"} (${summary.id || campaignId})`,
        `- Status: ${summary.status || "unknown"}`,
        `- Spend so far: ${spend}`,
        ``,
        `This changes real ad spend. Confirm this exact campaign with the account owner, then call again with confirmation: "${requiredConfirmation}".`,
        `To resume delivery later, use the activate-campaign recipe on this same campaign.`,
      ].join("\n"),
      metadata: {
        campaignId,
        requiredConfirmation,
        campaign: summary,
        spend,
      },
    };
  }

  const paused = await api.pauseCampaign(campaignId);
  const pausedSummary = summarizeCampaign(paused);

  return {
    status: "ok",
    reply: `Paused Meta Ads campaign ${pausedSummary.name || summary.name || campaignId} (${pausedSummary.id || campaignId}). Spend up to the pause: ${spend}. To resume delivery, ask to activate this campaign again.`,
    metadata: {
      campaignId,
      campaign: pausedSummary,
      spendAtPause: spend,
      reverseAction: "activate-campaign",
    },
  };
};
