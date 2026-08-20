const api = require("../src/api-client");
const { extractData, readArg, requireTextArg } = require("../src/recipe-helpers");
const { writeAudit } = require("../src/audit-log");
const fs = require("fs");
const path = require("path");

function saveLeadExport(name, data) {
  const directory = path.join(__dirname, "../data/lead-exports");
  fs.mkdirSync(directory, { recursive: true });
  const filePath = path.join(directory, `${name}.json`);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  return filePath;
}

module.exports.runRecipe = async function runRecipe(input = {}) {
  const mode = readArg(input, "mode", "form");
  if (mode === "lead") {
    const leadId = requireTextArg(input, ["leadId", "lead_id", "id"], "leadId");
    const lead = await api.getLead(leadId);
    const filePath = saveLeadExport(`lead-${leadId}`, lead);
    writeAudit("GET lead", { leadId }, { leadCount: 1 });
    return {
      status: "ok",
      reply: `Retrieved Meta lead ${leadId}. Lead data was saved to local data storage.`,
      metadata: { mode, leadId, leadCount: 1, filePath },
    };
  }
  const formId = requireTextArg(input, ["formId", "form_id", "id"], "formId");
  const leads = extractData(await api.getFormLeads(formId));
  const filePath = saveLeadExport(`form-${formId}`, leads);
  writeAudit("GET form leads", { formId }, { leadCount: leads.length });
  return {
    status: "ok",
    reply: `Retrieved ${leads.length} Meta leads for form ${formId}. Lead data was saved to local data storage.`,
    metadata: { mode: "form", formId, leadCount: leads.length, filePath },
  };
};
