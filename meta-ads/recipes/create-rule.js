const api = require("../src/api-client");
const { readArg, requireTextArg, writeGate } = require("../src/recipe-helpers");

module.exports.runRecipe = async function runRecipe(input = {}) {
  const name = requireTextArg(input, "name", "name");
  const dryRun = readArg(input, "dryRun", false) === true;
  writeGate("rules create");
  if (!dryRun) {
    const expectedConfirmation = `CONFIRM RULE ${name}`;
    if (readArg(input, "confirm") !== expectedConfirmation) {
      throw new Error(`Rule creation requires confirm: ${expectedConfirmation}`);
    }
  }
  const result = await api.createRule({
    name,
    evaluationSpec: readArg(input, ["evaluationSpec", "evaluation_spec"]),
    executionSpec: readArg(input, ["executionSpec", "execution_spec"]),
    scheduleSpec: readArg(input, ["scheduleSpec", "schedule_spec"]),
  }, dryRun);
  return {
    status: result.dryRun ? "dry_run" : "ok",
    reply: result.dryRun ? `Meta Ads rule dry run recorded for ${name}.` : `Created Meta Ads automated rule ${name}.`,
    metadata: { name, result },
  };
};
