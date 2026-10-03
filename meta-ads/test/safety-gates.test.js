const assert = require("assert");
const os = require("os");
const path = require("path");

const { checkDailyBudgetLimit, writeGate } = require("../src/recipe-helpers");
const api = require("../src/api-client");

async function run() {
  const previousWritesEnabled = process.env.META_ADS_WRITES_ENABLED;
  const previousBudgetLimit = process.env.META_ADS_MAX_DAILY_BUDGET_CENTS;
  const previousAuditPath = process.env.META_ADS_AUDIT_LOG_PATH;
  const previousFetch = global.fetch;

  try {
    delete process.env.META_ADS_WRITES_ENABLED;
    assert.throws(() => writeGate("test"), /writes disabled/);

    delete process.env.META_ADS_MAX_DAILY_BUDGET_CENTS;
    assert.throws(() => checkDailyBudgetLimit(2001, "test"), /exceeds the default cap of 2000 cents/);
    assert.doesNotThrow(() => checkDailyBudgetLimit(2000, "test"));

    process.env.META_ADS_MAX_DAILY_BUDGET_CENTS = "5000";
    assert.throws(() => checkDailyBudgetLimit(5001, "test"), /exceeds/);
    assert.doesNotThrow(() => checkDailyBudgetLimit(5000, "test"));
    for (const invalidLimit of ["", "not-a-number", "0", "-1", "Infinity"]) {
      process.env.META_ADS_MAX_DAILY_BUDGET_CENTS = invalidLimit;
      assert.throws(() => checkDailyBudgetLimit(5000, "test"), /META_ADS_MAX_DAILY_BUDGET_CENTS must be a positive finite number/);
    }

    process.env.META_ADS_MAX_DAILY_BUDGET_CENTS = "5000";

    process.env.META_ADS_AUDIT_LOG_PATH = path.join(os.tmpdir(), "meta-ads-audit-test.jsonl");
    global.fetch = async () => {
      throw new Error("dry-run must not make a network request");
    };
    api.setDryRun(true);
    const result = await api.apiCall("/dry-run-test", "POST", { name: "test" });
    assert.strictEqual(result.dryRun, true);
    assert.match(result.id, /^dry_run_\d+$/);
  } finally {
    api.setDryRun(false);
    global.fetch = previousFetch;
    if (previousWritesEnabled === undefined) delete process.env.META_ADS_WRITES_ENABLED;
    else process.env.META_ADS_WRITES_ENABLED = previousWritesEnabled;
    if (previousBudgetLimit === undefined) delete process.env.META_ADS_MAX_DAILY_BUDGET_CENTS;
    else process.env.META_ADS_MAX_DAILY_BUDGET_CENTS = previousBudgetLimit;
    if (previousAuditPath === undefined) delete process.env.META_ADS_AUDIT_LOG_PATH;
    else process.env.META_ADS_AUDIT_LOG_PATH = previousAuditPath;
  }
}

run()
  .then(() => console.log("safety-gates.test.js passed"))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
