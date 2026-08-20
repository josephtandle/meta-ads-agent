const api = require("../src/api-client");
const { buildListResponse, extractData } = require("../src/recipe-helpers");

module.exports.runRecipe = async function runRecipe() {
  const experiments = extractData(await api.listExperiments());
  return buildListResponse({
    title: "Meta Ads experiments",
    emptyMessage: "No Meta Ads experiments were found.",
    items: experiments,
    metadataKey: "experiments",
    renderRow: (experiment) => `${experiment.name || "Unnamed"} | ${experiment.type || "unknown"} | ${experiment.id || "unknown"}`,
  });
};
