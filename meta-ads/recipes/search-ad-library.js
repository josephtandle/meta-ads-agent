const api = require("../src/api-client");
const { readArg, requireTextArg } = require("../src/recipe-helpers");

module.exports.runRecipe = async function runRecipe(input = {}) {
  const searchTerms = requireTextArg(input, ["searchTerms", "search_terms", "terms", "query"], "search terms");
  const adReachedCountries = readArg(input, ["adReachedCountries", "ad_reached_countries", "countries"], ["US"]);
  const result = await api.searchAdLibrary({
    searchTerms,
    adReachedCountries,
    adType: readArg(input, ["adType", "ad_type"], "ALL"),
    adActiveStatus: readArg(input, ["adActiveStatus", "ad_active_status"], "ACTIVE"),
    limit: readArg(input, "limit", 25),
  });
  const ads = Array.isArray(result.data) ? result.data : [];
  return {
    status: "ok",
    reply: ads.length ? `Found ${ads.length} active competitor ads.` : "No active competitor ads found.",
    metadata: { searchTerms, adReachedCountries, ads },
  };
};
