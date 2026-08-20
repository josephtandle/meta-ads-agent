const api = require("../src/api-client");
const { readArg, requireTextArg } = require("../src/recipe-helpers");

module.exports.runRecipe = async function runRecipe(input = {}) {
  const mode = readArg(input, "mode", "search");
  if (mode === "reach") {
    const targetingSpec = readArg(input, ["targetingSpec", "targeting_spec"]);
    const result = await api.getReachEstimate({ targetingSpec });
    return { status: "ok", reply: "Retrieved Meta Ads reach estimate.", metadata: { targetingSpec, result } };
  }

  const q = requireTextArg(input, ["q", "query"], "query");
  const result = mode === "locations"
    ? await api.searchLocations({ q, limit: readArg(input, "limit", 25) })
    : await api.searchTargeting({ q, type: readArg(input, "type", "adinterest"), limit: readArg(input, "limit", 25) });
  const items = Array.isArray(result.data) ? result.data : [];
  return {
    status: "ok",
    reply: items.length ? `Found ${items.length} Meta Ads targeting results.` : "No Meta Ads targeting results found.",
    metadata: { mode, q, results: items },
  };
};
