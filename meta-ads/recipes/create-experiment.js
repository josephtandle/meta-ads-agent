const api = require("../src/api-client");
const { readArg, requireTextArg } = require("../src/recipe-helpers");

module.exports.runRecipe = async function runRecipe(input = {}) {
  const name = requireTextArg(input, "name", "name");
  const startTime = requireTextArg(input, ["startTime", "start_time"], "startTime");
  const endTime = requireTextArg(input, ["endTime", "end_time"], "endTime");
  const cells = readArg(input, "cells");
  if (!Array.isArray(cells) || !cells.length) throw new Error("cells must be a non-empty array");
  const result = await api.createExperiment({ name, startTime, endTime, cells }, readArg(input, "dryRun", false) === true);
  return {
    status: result.dryRun ? "dry_run" : "ok",
    reply: result.dryRun ? `Meta Ads experiment dry run recorded for ${name}.` : `Created Meta Ads experiment ${name}.`,
    metadata: { name, cellCount: cells.length, result },
  };
};
