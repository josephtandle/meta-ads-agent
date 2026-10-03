const api = require("../src/api-client");
const { readArg, requireTextArg, summarizeCampaign } = require("../src/recipe-helpers");

module.exports.runRecipe = async function runRecipe(input = {}) {
  const campaignId = requireTextArg(input, ["campaignId", "id"], "campaignId");
  const requiredConfirmation = `CONFIRM ACTIVATE ${campaignId}`;

  if (readArg(input, ["confirmation", "confirm"]) !== requiredConfirmation) {
    return {
      status: "blocked",
      reply: `Activation can start delivery and spend real money. Ask the account owner to confirm this exact campaign with: ${requiredConfirmation}`,
      metadata: {
        campaignId,
        requiredConfirmation,
        campaign: null,
      },
    };
  }

  const campaign = await api.activateCampaign(campaignId);
  const summary = summarizeCampaign(campaign);

  return {
    status: "ok",
    reply: `Activated Meta Ads campaign ${summary.name || campaignId} (${summary.id || campaignId}).`,
    metadata: {
      campaignId,
      campaign: summary,
    },
  };
};
