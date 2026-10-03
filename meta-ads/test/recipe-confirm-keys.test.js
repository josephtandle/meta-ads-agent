// The pause, activate and create-rule recipes accept both args.confirm (course
// material) and args.confirmation (older callers), prefer confirmation, and
// still reject a wrong phrase.
const assert = require("assert");
const Module = require("module");

const originalLoad = Module._load;
Module._load = function loadModule(request, parent, isMain) {
  if (request === "dotenv") return { config: () => ({ parsed: {} }) };
  return originalLoad.call(this, request, parent, isMain);
};

process.env.META_ADS_ACCESS_TOKEN = "test-token";
process.env.META_ADS_ACCOUNT_ID = "act_123";
const api = require("../src/api-client");
const pause = require("../recipes/pause-campaign");
const activate = require("../recipes/activate-campaign");
const createRule = require("../recipes/create-rule");

async function run() {
  const originals = { pauseCampaign: api.pauseCampaign, activateCampaign: api.activateCampaign, createRule: api.createRule, getCampaign: api.getCampaign };
  const previousWritesEnabled = process.env.META_ADS_WRITES_ENABLED;
  const previousFetch = global.fetch;
  try {
    process.env.META_ADS_WRITES_ENABLED = "true";
    global.fetch = async () => { throw new Error("recipes under test must not fetch"); };
    let calls = 0;
    api.pauseCampaign = async (id) => { calls += 1; return { id, name: "Paused one" }; };
    api.activateCampaign = async (id) => { calls += 1; return { id, name: "Active one" }; };
    api.createRule = async ({ name }) => { calls += 1; return { id: "rule-1", name }; };
    // Some recipe variants look the campaign up before deciding, so the blocked reply can describe it. That read is not a write.
    api.getCampaign = async (id) => ({ id, name: "Campaign one", status: "ACTIVE" });

    // A rejected confirmation is either a thrown error or a non-ok status (variants differ); both must mention the phrase.
    async function expectRejected(promise, pattern, message) {
      let result;
      try { result = await promise; } catch (error) { assert.match(String(error && error.message), pattern, message); return; }
      assert.notStrictEqual(result.status, "ok", message);
      assert.match(JSON.stringify(result), pattern, message);
    }

    const recipes = [
      { recipe: pause, args: { campaignId: "c1" }, phrase: "CONFIRM PAUSE c1", pattern: /CONFIRM PAUSE c1/ },
      { recipe: activate, args: { campaignId: "c1" }, phrase: "CONFIRM ACTIVATE c1", pattern: /CONFIRM ACTIVATE c1/ },
      { recipe: createRule, args: { name: "Pause costly", evaluationSpec: {}, executionSpec: {}, scheduleSpec: {} }, phrase: "CONFIRM RULE Pause costly", pattern: /CONFIRM RULE Pause costly/ },
    ];

    for (const { recipe, args, phrase, pattern } of recipes) {
      calls = 0;
      assert.strictEqual((await recipe.runRecipe({ args: { ...args, confirm: phrase } })).status, "ok", "confirm accepted");
      assert.strictEqual((await recipe.runRecipe({ args: { ...args, confirmation: phrase } })).status, "ok", "confirmation accepted");
      assert.strictEqual((await recipe.runRecipe({ args: { ...args, confirmation: phrase, confirm: "CONFIRM WRONG" } })).status, "ok", "confirmation wins when both are present");
      assert.strictEqual(calls, 3);

      await expectRejected(recipe.runRecipe({ args }), pattern, "missing phrase rejected");
      await expectRejected(recipe.runRecipe({ args: { ...args, confirm: "CONFIRM WRONG" } }), pattern, "wrong confirm rejected");
      await expectRejected(recipe.runRecipe({ args: { ...args, confirmation: "CONFIRM WRONG" } }), pattern, "wrong confirmation rejected");
      await expectRejected(recipe.runRecipe({ args: { ...args, confirmation: "CONFIRM WRONG", confirm: phrase } }), pattern, "confirmation is preferred, so a wrong confirmation rejects even with a right confirm");
      await expectRejected(recipe.runRecipe({ args: { ...args, confirm: phrase.toLowerCase() } }), pattern, "phrase check stays exact");
      assert.strictEqual(calls, 3, "rejected calls never reach the API client");
    }
  } finally {
    Object.assign(api, originals);
    global.fetch = previousFetch;
    Module._load = originalLoad;
    if (previousWritesEnabled === undefined) delete process.env.META_ADS_WRITES_ENABLED;
    else process.env.META_ADS_WRITES_ENABLED = previousWritesEnabled;
  }
}

run()
  .then(() => console.log("recipe-confirm-keys.test.js passed"))
  .catch((error) => { console.error(error); process.exit(1); });
