const api = require("../src/api-client");
const { readArg, requireTextArg } = require("../src/recipe-helpers");

module.exports.runRecipe = async function runRecipe(input = {}) {
  const reportRunId = readArg(input, ["reportRunId", "report_run_id"]);
  if (reportRunId) {
    const result = await api.getAsyncReportStatus(String(reportRunId));
    return {
      status: "ok",
      reply: result.async_status === "Job Completed" ? "Meta Ads async insights report is complete." : `Meta Ads async insights status: ${result.async_status || "unknown"}.`,
      metadata: { reportRunId, result },
    };
  }

  const objectId = requireTextArg(input, ["objectId", "id"], "objectId");
  const result = await api.createAsyncReport({
    objectId,
    fields: readArg(input, "fields", undefined),
    breakdowns: readArg(input, "breakdowns", undefined),
    timeRange: readArg(input, ["timeRange", "range"], "last_30d"),
    level: readArg(input, "level", undefined),
  });
  return {
    status: "ok",
    reply: `Created Meta Ads async insights report ${result.report_run_id || result.id || "unknown"}.`,
    metadata: { objectId, reportRunId: result.report_run_id || result.id || null, result },
  };
};
