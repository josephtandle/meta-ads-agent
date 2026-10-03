// Connector mode (3.5): Claude uses Meta's official Ads connector, so this
// agent never makes the call. These tests cover what it still does: the
// external audit log, doctor's connection/cap/writes report, the connector
// creative-test recipe, and an offline policy check with no Meta settings.
// Offline: every child process records and refuses any network attempt.
const test = require("node:test");
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const { readinessReport } = require("../src/readiness");

const agentRoot = path.join(__dirname, "..");
const cli = path.join(agentRoot, "src/index.js");
const FAKE_TOKEN = "connector-test-token-7Q2";
const FAKE_SECRET = "connector-test-secret-9Z4";
// Built at runtime so no token-shaped literal sits in the file (the release scrub refuses them).
const TOKEN_SHAPED = ["EAA", "B1234567890", "abcdefghijklmnopqrstuvwxyz"].join("");

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "meta-ads-connector-"));
  const networkPath = path.join(dir, "network-attempted");
  const hook = path.join(dir, "record-network.js");
  fs.writeFileSync(hook, `
    const fs = require("fs");
    const record = (what) => { fs.appendFileSync(${JSON.stringify(networkPath)}, String(what) + "\\n"); throw new Error("network must not be called"); };
    global.fetch = async (url) => record(url);
    for (const m of ["http", "https"]) { require(m).request = record; require(m).get = record; }
    require("net").connect = record; require("net").createConnection = record; require("tls").connect = record;
  `);
  const env = {
    PATH: process.env.PATH,
    HOME: dir,
    META_ADS_IGNORE_ENV_FILES: "1",
    META_ADS_AUDIT_LOG_PATH: path.join(dir, "audit.jsonl"),
    NODE_OPTIONS: `--require=${JSON.stringify(hook)}`,
  };
  const run = (args, extra = {}) => spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", env: { ...env, ...extra }, cwd: dir });
  const auditLines = () => (fs.existsSync(env.META_ADS_AUDIT_LOG_PATH)
    ? fs.readFileSync(env.META_ADS_AUDIT_LOG_PATH, "utf8").trim().split("\n").filter(Boolean)
    : []);
  return { dir, env, run, auditLines, networkPath, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test("audit log-external appends a redacted connector line and audit tail prints it", () => {
  const t = setup();
  try {
    const summary = `Created campaign Spring test (PAUSED) token ${FAKE_TOKEN} ${TOKEN_SHAPED} access_token=abc123`;
    const logged = t.run(["audit", "log-external", summary, "--ids", "120001,120002"], { META_ADS_ACCESS_TOKEN: FAKE_TOKEN });
    assert.strictEqual(logged.status, 0, logged.stderr);
    assert.match(logged.stdout, /Nothing was sent to Meta/);
    const lines = t.auditLines();
    assert.strictEqual(lines.length, 1);
    const raw = lines[0];
    for (const secret of [FAKE_TOKEN, TOKEN_SHAPED, "abc123"]) assert.ok(!raw.includes(secret), `audit line leaks ${secret}`);
    const entry = JSON.parse(raw);
    assert.strictEqual(entry.source, "connector");
    assert.strictEqual(entry.action, "EXTERNAL CHANGE (connector)");
    assert.deepStrictEqual(entry.request.ids, ["120001", "120002"]);
    assert.match(entry.request.summary, /Created campaign Spring test \(PAUSED\)/);
    assert.match(entry.request.summary, /<redacted>/);
    assert.strictEqual(entry.result.sentByThisAgent, false);

    const custom = t.run(["audit", "log-external", "Edited ad name in Ads Manager", "--source", "ads-manager"]);
    assert.strictEqual(custom.status, 0, custom.stderr);
    assert.strictEqual(JSON.parse(t.auditLines()[1]).source, "ads-manager");

    const tail = t.run(["audit", "tail", "5"], { META_ADS_ACCESS_TOKEN: FAKE_TOKEN });
    assert.strictEqual(tail.status, 0, tail.stderr);
    const printed = tail.stdout.trim().split("\n");
    assert.strictEqual(printed.length, 2);
    assert.match(printed[0], /"source":"connector"/);
    assert.match(printed[0], /Spring test/);
    assert.ok(!tail.stdout.includes(FAKE_TOKEN) && !tail.stdout.includes(TOKEN_SHAPED));
    assert.strictEqual(t.run(["audit", "tail", "1"]).stdout.trim().split("\n").length, 1);

    const empty = t.run(["audit", "log-external", "  "]);
    assert.notStrictEqual(empty.status, 0, "an empty summary is refused");
    assert.strictEqual(fs.existsSync(t.networkPath), false, "audit commands never call the network");
  } finally {
    t.cleanup();
  }
});

test("doctor in connector mode: no token is expected, cap and writes shown, no secrets, no network", () => {
  const t = setup();
  try {
    const result = t.run(["doctor"], {
      META_ADS_CONNECTION: "connector",
      META_ADS_APP_SECRET: FAKE_SECRET,
      META_ADS_MAX_DAILY_BUDGET_CENTS: "1500",
    });
    assert.strictEqual(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.strictEqual(report.connection, "connector");
    assert.strictEqual(report.status, "connector_mode");
    assert.deepStrictEqual(report.missing, [], "the missing token is not a red finding in connector mode");
    assert.ok(report.expectedMissing.includes("META_ADS_ACCESS_TOKEN"));
    assert.ok(report.liveChecks.every((check) => check.status === "skipped" && /Connector mode/.test(check.detail)));
    assert.strictEqual(report.budgetCap.limitCents, 1500);
    assert.strictEqual(report.budgetCap.limitDollars, "$15.00");
    assert.strictEqual(report.writes, "off");
    assert.strictEqual(report.budgetCap.writesEnabled, false);
    assert.match(result.stderr, /Connection: connector\. Budget cap: 1500 cents \(\$15\.00\) a day\. Writes: off\./);
    assert.ok(!result.stdout.includes(FAKE_SECRET) && !result.stderr.includes(FAKE_SECRET), "doctor never prints a secret value");
    assert.ok(report.optionalSettings.some((item) => item.name === "META_ADS_CONNECTION" && item.present === true));
    assert.ok(report.optionalSettings.every((item) => Object.keys(item).sort().join() === "name,present,source"));
    assert.strictEqual(fs.existsSync(t.networkPath), false, "connector doctor makes no network call");

    const writesOn = JSON.parse(t.run(["doctor"], { META_ADS_CONNECTION: "connector", META_ADS_WRITES_ENABLED: "true" }).stdout);
    assert.strictEqual(writesOn.writes, "on");
    assert.strictEqual(writesOn.budgetCap.limitCents, 2000);
    assert.strictEqual(writesOn.budgetCap.limitDollars, "$20.00");

    const neither = JSON.parse(t.run(["doctor"]).stdout);
    assert.strictEqual(neither.connection, "not_set");
    assert.strictEqual(neither.status, "offline_copilot_only");
    assert.ok(neither.missing.includes("META_ADS_ACCESS_TOKEN"), "without connector mode a missing token is still reported");
  } finally {
    t.cleanup();
  }
});

test("doctor with a token reports connection api", async () => {
  const report = await readinessReport({
    environment: { META_ADS_ACCESS_TOKEN: FAKE_TOKEN, META_ADS_ACCOUNT_ID: "act_1", META_ADS_APP_ID: "app", META_ADS_APP_SECRET: FAKE_SECRET, META_ADS_CONNECTION: "connector" },
    fileEnv: {},
    apiClient: { apiCall: async (endpoint) => (endpoint === "/act_1" ? { id: "act_1", name: "Test", account_status: 1, currency: "USD", timezone_name: "UTC" } : { name: "App" }) },
  });
  assert.strictEqual(report.connection, "api");
  assert.strictEqual(report.status, "ready_for_live_api");
  assert.ok(!JSON.stringify(report).includes(FAKE_TOKEN) && !JSON.stringify(report).includes(FAKE_SECRET));
});

function runRecipe(t, args, extra = {}) {
  const script = `
    const recipe = require(${JSON.stringify(path.join(agentRoot, "recipes/connector-creative-test.js"))});
    recipe.runRecipe({ args: ${JSON.stringify(args)} })
      .then((r) => { process.stdout.write(JSON.stringify(r)); })
      .catch((e) => { process.stdout.write(JSON.stringify({ error: e.message })); });
  `;
  const result = spawnSync(process.execPath, ["-e", script], { encoding: "utf8", env: { ...t.env, ...extra }, cwd: t.dir });
  assert.strictEqual(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

const cleanVariants = [
  { label: "A", headline: "Breathing classes on Tuesdays", primaryText: "Explore guided breathing classes. See the schedule.", cta: "LEARN_MORE" },
  { label: "B", headline: "Calm starts here", primaryText: "Small group breathing classes in town. Book a free first class.", description: "Free first class", cta: "BOOK_NOW" },
];

test("connector recipe: refuses BLOCK, passes with an audited override, clamps budget, never calls the network", () => {
  const t = setup();
  try {
    const blockedVariants = [cleanVariants[0], { label: "B", headline: "Feel better fast", primaryText: "Are you struggling with anxiety? Feel better in 7 days, guaranteed." }];
    const refused = runRecipe(t, { offer: "Breathing classes", variants: blockedVariants, dailyBudgetCents: 1000 });
    assert.strictEqual(refused.status, "blocked");
    assert.match(refused.reply, /Refused/);
    assert.match(refused.reply, /personal-attributes-health/);
    assert.strictEqual(refused.metadata.sentToMeta, false);
    assert.strictEqual(t.auditLines().length, 0, "a refusal writes nothing");

    const overridden = runRecipe(t, { offer: "Breathing classes", variants: blockedVariants, dailyBudgetCents: 1000, policyOverride: "Cleared with Meta support on 3 Oct" });
    assert.strictEqual(overridden.status, "ok", overridden.error);
    assert.strictEqual(overridden.metadata.policyOverride, "Cleared with Meta support on 3 Oct");
    assert.match(overridden.reply, /BLOCK overridden/);
    const audit = t.auditLines().map((line) => JSON.parse(line));
    assert.strictEqual(audit.length, 1);
    assert.strictEqual(audit[0].action, "POLICY OVERRIDE connector creative test (recipe)");
    assert.strictEqual(audit[0].source, "connector");
    assert.strictEqual(audit[0].request.reason, "Cleared with Meta support on 3 Oct");

    const clamped = runRecipe(t, { offer: "Breathing classes", audienceNotes: "Adults near Ubud", link: "https://example.com", variants: cleanVariants, dailyBudgetCents: 5000 }, { META_ADS_MAX_DAILY_BUDGET_CENTS: "2000" });
    assert.strictEqual(clamped.status, "ok", clamped.error);
    assert.strictEqual(clamped.metadata.dailyBudgetCents, 2000);
    assert.strictEqual(clamped.metadata.budgetClamped, true);
    assert.match(clamped.reply, /you asked for 5000 cents \(\$50\.00\) a day\. The cap is 2000 cents \(\$20\.00\), so the plan uses 2000 cents/);
    assert.ok(clamped.metadata.steps.slice(0, 4).every((step) => /PAUSED/.test(step)), "campaign, ad set and every ad are PAUSED");
    assert.strictEqual(clamped.metadata.auditLines.length, 4);
    assert.ok(clamped.metadata.auditLines.every((line) => line.startsWith("node src/index.js audit log-external \"")));
    assert.match(clamped.reply, /wait for a clear yes/);

    const within = runRecipe(t, { offer: "Breathing classes", variants: cleanVariants, dailyBudgetCents: 800 });
    assert.strictEqual(within.metadata.dailyBudgetCents, 800);
    assert.strictEqual(within.metadata.budgetClamped, false);

    const handoffPath = path.join(t.dir, "handoff.json");
    fs.writeFileSync(handoffPath, JSON.stringify({ slides: [{ headline: "Make $10,000 a month from home with our proven system." }] }));
    const handoffBlocked = runRecipe(t, { offer: "Breathing classes", variants: cleanVariants, dailyBudgetCents: 800, handoffFile: handoffPath });
    assert.strictEqual(handoffBlocked.status, "blocked", "a BLOCK in the handoff file is refused too");

    assert.match(runRecipe(t, { offer: "Breathing classes", variants: [cleanVariants[0]], dailyBudgetCents: 800 }).error, /2 to 4 variants/);
    assert.strictEqual(fs.existsSync(t.networkPath), false, "the recipe never calls the network");
  } finally {
    t.cleanup();
  }
});

test("policy check works with an empty environment (install smoke test)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "meta-ads-empty-env-"));
  try {
    // Only the switch that keeps a developer's real .env out of the run.
    const env = { META_ADS_IGNORE_ENV_FILES: "1" };
    const pass = spawnSync(process.execPath, [cli, "policy", "check", "Explore guided breathing classes. See the schedule."], { encoding: "utf8", env, cwd: dir });
    assert.strictEqual(pass.status, 0, pass.stderr);
    assert.match(pass.stdout, /PASS/);
    const block = spawnSync(process.execPath, [cli, "policy", "check", "Are you struggling with anxiety? Feel better in 7 days, guaranteed."], { encoding: "utf8", env, cwd: dir });
    assert.strictEqual(block.status, 2, block.stderr);
    assert.match(block.stdout, /BLOCK/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
