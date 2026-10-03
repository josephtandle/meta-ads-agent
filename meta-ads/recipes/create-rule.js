const api = require("../src/api-client");
const { readArg, requireTextArg, writeGate } = require("../src/recipe-helpers");

// Course material passes args.confirm; older callers pass args.confirmation.
// Both are accepted, confirmation first. The exact phrase check is unchanged.
const CONFIRM_KEYS = ["confirmation", "confirm"];

module.exports.runRecipe = async function runRecipe(input = {}) {
  const name = requireTextArg(input, "name", "name");
  const dryRun = readArg(input, "dryRun", false) === true;
  if (!dryRun) {
    writeGate("rules create");
    const expectedConfirmation = `CONFIRM RULE ${name}`;
    if (readArg(input, CONFIRM_KEYS) !== expectedConfirmation) {
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
