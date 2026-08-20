const api = require("../src/api-client");
const { readArg, requireTextArg } = require("../src/recipe-helpers");

module.exports.runRecipe = async function runRecipe(input = {}) {
  const objectId = requireTextArg(input, ["objectId", "campaignId", "adSetId", "id"], "objectId");
  const dailyBudgetCents = Number(requireTextArg(input, ["dailyBudgetCents", "daily_budget"], "dailyBudgetCents"));
  const result = await api.updateBudget(objectId, dailyBudgetCents, { dryRun: readArg(input, "dryRun", false) === true });

  return {
    status: result.dryRun ? "dry_run" : "ok",
    reply: result.dryRun
      ? `Meta Ads budget update dry run recorded for ${objectId}.`
      : `Updated Meta Ads daily budget for ${objectId} to ${dailyBudgetCents} cents.`,
    metadata: { objectId, dailyBudgetCents, result },
  };
};
