const api = require("../src/api-client");
const { readArg } = require("../src/recipe-helpers");

module.exports.runRecipe = async function runRecipe(input = {}) {
  const args = input.args || input;
  const spec = input.spec || args.spec || args;
  const dryRun = Object.prototype.hasOwnProperty.call(input, "dryRun")
    ? input.dryRun !== false
    : readArg(input, "dryRun", true) !== false;
  const metadata = await api.createCarouselCreative(spec, dryRun);
  return {
    status: metadata.dryRun ? "dry_run" : "ok",
    reply: metadata.dryRun
      ? `Carousel creative dry run prepared for ${metadata.summary.cardCount} cards.`
      : `Created carousel creative ${metadata.creativeId}. No ad was created.`,
    metadata,
  };
};
