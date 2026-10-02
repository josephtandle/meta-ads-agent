const api = require("../src/api-client");
const { readArg, requireTextArg } = require("../src/recipe-helpers");

module.exports.runRecipe = async function runRecipe(input = {}) {
  const source = requireTextArg(input, ["filePath", "path", "url", "source"], "filePath or url");
  const name = readArg(input, "name", undefined);
  const image = /^https?:\/\//i.test(source)
    ? { url: source, name }
    : { filePath: source, name };

  const result = await api.uploadAdImage(image, readArg(input, "dryRun", false) === true);
  return {
    status: result.response?.dryRun ? "dry_run" : "ok",
    reply: result.response?.dryRun
      ? "Meta Ads image upload dry run recorded."
      : `Uploaded Meta Ads image with hash ${result.hash || "unknown"}.`,
    metadata: result,
  };
};
