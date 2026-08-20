const api = require("../src/api-client");
const { buildListResponse, extractData } = require("../src/recipe-helpers");

module.exports.runRecipe = async function runRecipe() {
  const rules = extractData(await api.listRules());
  return buildListResponse({
    title: "Meta Ads automated rules",
    emptyMessage: "No Meta Ads automated rules were found.",
    items: rules,
    metadataKey: "rules",
    renderRow: (rule) => `${rule.name || "Unnamed"} | ${rule.status || "unknown"} | ${rule.id || "unknown"}`,
  });
};
