const api = require("../src/api-client");
const { buildListResponse, extractData, requireTextArg } = require("../src/recipe-helpers");

module.exports.runRecipe = async function runRecipe(input = {}) {
  const pageId = requireTextArg(input, ["pageId", "page_id", "id"], "pageId");
  const forms = extractData(await api.listLeadForms(pageId));
  return buildListResponse({
    title: "Meta lead forms",
    emptyMessage: "No Meta lead forms were found.",
    items: forms,
    metadataKey: "forms",
    renderRow: (form) => `${form.name || "Unnamed"} | ${form.status || "unknown"} | ${form.id || "unknown"}`,
  });
};
