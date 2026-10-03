// Dry runs must work with META_ADS_WRITES_ENABLED unset, make zero write
// calls, print what would be sent and leave an audit entry marked dryRun.
// The same command without --dry-run must still be refused with the
// writes-disabled message before any network call.
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const cli = path.join(__dirname, "../src/index.js");

async function run() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "meta-ads-dry-run-off-"));
  const networkAttemptPath = path.join(tempDir, "network-attempted");
  const auditPath = path.join(tempDir, "audit.jsonl");
  const fetchHookPath = path.join(tempDir, "block-network.js");
  fs.writeFileSync(fetchHookPath, `
    const fs = require("fs");
    global.fetch = async (url) => {
      fs.appendFileSync(process.env.META_ADS_NETWORK_ATTEMPT_PATH, String(url) + "\\n");
      throw new Error("network must not be called");
    };
  `);
  const env = {
    ...process.env,
    META_ADS_ACCESS_TOKEN: "test-token",
    META_ADS_ACCOUNT_ID: "act_123",
    META_ADS_APP_ID: "test-app",
    META_ADS_APP_SECRET: "test-secret",
    META_ADS_AUDIT_LOG_PATH: auditPath,
    META_ADS_NETWORK_ATTEMPT_PATH: networkAttemptPath,
    NODE_OPTIONS: `${process.env.NODE_OPTIONS || ""} --require=${JSON.stringify(fetchHookPath)}`.trim(),
  };
  delete env.META_ADS_WRITES_ENABLED;
  // Never read the agent's or the workspace's real .env in this test: a live
  // writes flag there would turn these dry runs into real write attempts.
  env.META_ADS_IGNORE_ENV_FILES = "1";
  const runCli = (args) => spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", env });

  const rule = JSON.stringify({ name: "Pause costly ad sets", evaluationSpec: {}, executionSpec: {}, scheduleSpec: {} });
  const experiment = JSON.stringify({ name: "Split test", startTime: "2026-10-10T00:00:00+0000", endTime: "2026-10-17T00:00:00+0000", cells: [{ name: "A", campaign_id: "c1" }] });
  const creative = JSON.stringify({ name: "Hook A", pageId: "page-1", message: "More sales", link: "https://example.com" });
  const ad = JSON.stringify({ adSetId: "as1", creativeId: "cr1", name: "Hook A ad" });
  const campaign = JSON.stringify({ name: "Draft", objective: "OUTCOME_SALES", dailyBudget: 5 });

  const cases = [
    { label: "campaigns budget", dry: ["campaigns", "budget", "c1", "500"], live: ["campaigns", "budget", "c1", "500", "--confirm", "CONFIRM BUDGET c1"], sent: /"daily_budget": 500/ },
    { label: "rules create", dry: ["rules", "create", rule], live: ["rules", "create", rule, "--confirm", "CONFIRM RULE Pause costly ad sets"], sent: /"name": "Pause costly ad sets"/ },
    { label: "experiments create", dry: ["experiments", "create", experiment], live: ["experiments", "create", experiment], sent: /"name": "Split test"/ },
    { label: "creatives create", dry: ["creatives", "create", creative], live: ["creatives", "create", creative], sent: /"page_id": "page-1"/ },
    { label: "ads create", dry: ["ads", "create", ad], live: ["ads", "create", ad], sent: /"adset_id": "as1"/ },
    // Same ordering bug, same fix; covered for completeness.
    { label: "campaigns create", dry: ["campaigns", "create", campaign], live: ["campaigns", "create", campaign], sent: /"objective": "OUTCOME_SALES"/ },
    { label: "campaigns pause", dry: ["campaigns", "pause", "c1"], live: ["campaigns", "pause", "c1", "--confirm", "CONFIRM PAUSE c1"], sent: /"status": "PAUSED"/ },
  ];

  try {
    for (const testCase of cases) {
      fs.rmSync(auditPath, { force: true });
      const dryRun = runCli([...testCase.dry, "--dry-run"]);
      assert.strictEqual(dryRun.status, 0, `${testCase.label} --dry-run with writes off must succeed: ${dryRun.stderr}`);
      assert.match(dryRun.stdout, /"dryRun": true/, testCase.label);
      assert.match(dryRun.stdout, /"request": \{/, `${testCase.label} dry run prints what would be sent`);
      assert.match(dryRun.stdout, testCase.sent, `${testCase.label} dry run shows the body`);
      assert.match(dryRun.stderr, /Meta Ads dry run \(nothing sent\)/, testCase.label);
      assert.strictEqual(fs.existsSync(networkAttemptPath), false, `${testCase.label} dry run made a network call`);
      const auditLines = fs.readFileSync(auditPath, "utf8").trim().split("\n").map((line) => JSON.parse(line));
      assert.ok(auditLines.length >= 1, `${testCase.label} dry run writes an audit entry`);
      assert.ok(auditLines.every((entry) => entry.result.dryRun === true), `${testCase.label} audit entries are marked dryRun`);

      fs.rmSync(auditPath, { force: true });
      const live = runCli(testCase.live);
      assert.notStrictEqual(live.status, 0, `${testCase.label} live with writes off must be refused`);
      assert.match(live.stderr, /writes disabled: set META_ADS_WRITES_ENABLED=true/, `${testCase.label}: ${live.stderr}`);
      assert.strictEqual(fs.existsSync(networkAttemptPath), false, `${testCase.label} live refusal made a network call`);
      assert.strictEqual(fs.existsSync(auditPath), false, `${testCase.label} live refusal must not write an audit entry`);
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

run()
  .then(() => console.log("dry-run-writes-off.test.js passed"))
  .catch((error) => { console.error(error); process.exit(1); });
