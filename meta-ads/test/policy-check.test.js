// Meta policy check: rules, input shapes, CLI exit codes, the create-path
// guard with --policy-override, the doctor freshness warning and the recipes.
// Offline: every CLI run here blocks fetch and uses --dry-run.
const test = require("node:test");
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const policy = require("../src/policy-check");
const { readinessReport } = require("../src/readiness");

const cli = path.join(__dirname, "../src/index.js");
const rulesFile = JSON.parse(fs.readFileSync(path.join(__dirname, "../policies/rules.json"), "utf8"));

function ids(report) {
  return [...new Set(report.findings.map((finding) => finding.ruleId))];
}

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function cliEnv(dir) {
  const hook = path.join(dir, "block-network.js");
  fs.writeFileSync(hook, "global.fetch = async () => { throw new Error('network must not be called'); };");
  const env = {
    ...process.env,
    META_ADS_ACCESS_TOKEN: "test-token",
    META_ADS_ACCOUNT_ID: "act_123",
    META_ADS_APP_ID: "test-app",
    META_ADS_APP_SECRET: "test-secret",
    META_ADS_AUDIT_LOG_PATH: path.join(dir, "audit.jsonl"),
    NODE_OPTIONS: `${process.env.NODE_OPTIONS || ""} --require=${JSON.stringify(hook)}`.trim(),
  };
  // Set, not deleted: dotenv never overrides a set variable, so a real .env
  // with writes on cannot leak into these runs.
  env.META_ADS_WRITES_ENABLED = "false";
  return env;
}

function readAudit(dir) {
  const file = path.join(dir, "audit.jsonl");
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

test("personal attribute plus guarantee is a BLOCK", () => {
  const report = policy.checkText("Are you struggling with anxiety? Feel better in 7 days, guaranteed.");
  assert.strictEqual(report.status, "BLOCK");
  assert.strictEqual(report.exitCode, 2);
  assert.ok(ids(report).includes("personal-attributes-health"));
  assert.ok(ids(report).includes("guaranteed-results"));
  const finding = report.findings.find((item) => item.ruleId === "personal-attributes-health");
  assert.strictEqual(finding.phrase, "Are you struggling with anxiety?");
  assert.ok(finding.explain && finding.rewrite && finding.source, "every finding has an explanation, a rewrite and a source");
});

test("a plain service description passes", () => {
  const report = policy.checkText("Explore guided breathing classes. See the schedule.");
  assert.strictEqual(report.status, "PASS");
  assert.strictEqual(report.exitCode, 0);
  assert.deepStrictEqual(report.findings, []);
});

test("an income claim is a BLOCK", () => {
  const report = policy.checkText("Make $10,000 a month from home with our proven system.");
  assert.strictEqual(report.status, "BLOCK");
  assert.ok(ids(report).includes("income-claims"));
  assert.match(report.findings.find((f) => f.ruleId === "income-claims").phrase, /Make \$10,000 a month/);
});

test("time pressure is a WARN", () => {
  const report = policy.checkText("Hurry, the workshop offer ends tonight.");
  assert.strictEqual(report.status, "WARN");
  assert.strictEqual(report.exitCode, 1);
  assert.ok(ids(report).includes("false-urgency"));
});

test("a housing offer asks the user to declare the special category", () => {
  const report = policy.checkText("Two-bedroom apartment for rent near downtown. Book a viewing.");
  assert.strictEqual(report.status, "WARN");
  assert.ok(ids(report).includes("special-category-housing"));
  assert.deepStrictEqual(report.specialCategories, ["HOUSING"]);
  assert.match(policy.formatReport(report), /Special ad category to declare: HOUSING/);
});

test("a money-back guarantee is not a results guarantee", () => {
  assert.strictEqual(policy.checkText("Every order has a money-back guarantee.").status, "PASS");
});

test("a Content Studio Meta handoff is checked, including the image text", () => {
  const handoff = {
    name: "Breathing deck",
    pageId: "FILL_IN_PAGE_ID",
    instagramUserId: "FILL_IN_INSTAGRAM_USER_ID",
    message: "Guided breathing classes for busy people.",
    link: "FILL_IN_LINK",
    callToAction: "LEARN_MORE",
    optimizeOrder: false,
    endCard: true,
    cards: [
      { image: "slide-1.png", headline: "Are you over 50 and always tired?" },
      { image: "slide-2.png", headline: "Three short sessions a week" },
    ],
    overlayText: ["Tired of your belly fat?"],
  };
  const report = policy.checkCreative(handoff);
  const fields = report.fieldsChecked.map((item) => item.field);
  for (const field of ["primaryText", "headline", "callToAction", "link", "overlayText"]) assert.ok(fields.includes(field), `${field} is checked`);
  assert.strictEqual(report.status, "BLOCK");
  assert.ok(ids(report).includes("personal-attributes-age"), "card headline is checked");
  assert.ok(ids(report).includes("negative-self-image"), "image overlay text is checked");
  assert.ok(ids(report).includes("landing-page-placeholder"), "placeholder link is flagged");
  assert.match(policy.formatReport(report), /card 1 headline/);
  // Slides with lines, as a deck export carries them, are image text too.
  const slides = policy.checkCreative({ slides: [{ title: "Shocking results", lines: ["Lose 10 kg in a week"] }] });
  assert.ok(slides.findings.every((f) => f.field === "overlayText"));
  assert.ok(ids(slides).includes("sensational-clickbait"));
  assert.ok(ids(slides).includes("weight-loss-claims"));
});

test("Meta API creative shapes and the local cache are read", () => {
  const dir = tempDir("meta-ads-policy-cache-");
  try {
    fs.writeFileSync(path.join(dir, "ads.json"), JSON.stringify([
      { id: "111111", name: "Risky", effective_status: "DISAPPROVED", creative: { id: "222222", title: "Quit your job", object_story_spec: { link_data: { message: "Fresh bread daily", link: "http://bakery.test" } } } },
      { id: "333333", name: "Clean", creative: { id: "444444", body: "Fresh bread daily" } },
    ]));
    const found = policy.findCached("222222", dir);
    assert.strictEqual(found.kind, "creative");
    const report = policy.checkCreative(found.creative);
    assert.ok(ids(report).includes("income-claims"));
    assert.ok(ids(report).includes("landing-page-https"));
    const risks = policy.cachedAdRisks(dir);
    assert.deepStrictEqual(risks.map((item) => item.id), ["111111"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("policy check CLI: exit codes, --json and rules listing", () => {
  const dir = tempDir("meta-ads-policy-cli-");
  try {
    const env = cliEnv(dir);
    const block = spawnSync(process.execPath, [cli, "policy", "check", "Are you struggling with anxiety? Feel better in 7 days, guaranteed."], { encoding: "utf8", env });
    assert.strictEqual(block.status, 2, block.stderr);
    assert.match(block.stdout, /BLOCK\s+personal-attributes-health/);
    assert.match(block.stdout, /Try:/);
    const pass = spawnSync(process.execPath, [cli, "policy", "check", "Explore guided breathing classes. See the schedule."], { encoding: "utf8", env });
    assert.strictEqual(pass.status, 0, pass.stderr);
    const warnJson = spawnSync(process.execPath, [cli, "policy", "check", "Last chance to join.", "--json"], { encoding: "utf8", env });
    assert.strictEqual(warnJson.status, 1);
    assert.strictEqual(JSON.parse(warnJson.stdout).status, "WARN");
    const file = path.join(dir, "creative.json");
    fs.writeFileSync(file, JSON.stringify({ message: "We're hiring a part-time baker. Join our team." }));
    const fromFile = spawnSync(process.execPath, [cli, "policy", "check", file, "--json"], { encoding: "utf8", env });
    assert.deepStrictEqual(JSON.parse(fromFile.stdout).specialCategories, ["EMPLOYMENT"]);

    const rules = spawnSync(process.execPath, [cli, "policy", "rules", "--json"], { encoding: "utf8", env });
    assert.strictEqual(rules.status, 0, rules.stderr);
    const listed = JSON.parse(rules.stdout).map((rule) => rule.id).sort();
    const expected = [...rulesFile.rules, ...rulesFile.specialCategories].map((rule) => rule.id).sort();
    assert.deepStrictEqual(listed, expected, "policy rules lists every rule in rules.json");
    assert.strictEqual(new Set(expected).size, expected.length, "rule ids are unique");
    for (const rule of [...rulesFile.rules, ...rulesFile.specialCategories]) {
      assert.ok(["BLOCK", "WARN"].includes(rule.level), `${rule.id} level`);
      assert.ok(rule.explain && rule.rewrite && rule.source && rule.section, `${rule.id} has owner text`);
      assert.ok(!JSON.stringify(rule).includes("\u2014"), `${rule.id}: no em dashes`);
    }
    const text = spawnSync(process.execPath, [cli, "policy", "rules"], { encoding: "utf8", env });
    for (const id of expected) assert.ok(text.stdout.includes(id), `${id} in the plain listing`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("create paths refuse a BLOCK in dry run and accept --policy-override, which is audited", () => {
  const dir = tempDir("meta-ads-policy-create-");
  try {
    const env = cliEnv(dir);
    const creative = JSON.stringify({ name: "Calm", pageId: "123", message: "Are you struggling with anxiety? Feel better in 7 days, guaranteed.", link: "https://calm.test" });

    const refused = spawnSync(process.execPath, [cli, "creatives", "create", creative, "--dry-run"], { encoding: "utf8", env });
    assert.strictEqual(refused.status, 2, refused.stderr);
    assert.match(refused.stderr, /creatives create refused/);
    assert.match(refused.stderr, /personal-attributes-health/);
    assert.match(refused.stderr, /Try:/, "the rewrite is shown");
    assert.match(refused.stderr, /--policy-override/);
    assert.deepStrictEqual(readAudit(dir), [], "a refused create sends nothing and audits nothing");

    const emptyReason = spawnSync(process.execPath, [cli, "creatives", "create", creative, "--dry-run", "--policy-override", ""], { encoding: "utf8", env });
    assert.notStrictEqual(emptyReason.status, 0);
    assert.match(emptyReason.stderr, /needs a reason/);

    const overridden = spawnSync(process.execPath, [cli, "creatives", "create", creative, "--dry-run", "--policy-override", "Reviewed with Meta support"], { encoding: "utf8", env });
    assert.strictEqual(overridden.status, 0, overridden.stderr);
    assert.match(overridden.stdout, /"dryRun": true/);
    const audit = readAudit(dir);
    const override = audit.find((entry) => entry.action === "POLICY OVERRIDE creatives create");
    assert.ok(override, "override is in the audit log");
    assert.strictEqual(override.request.reason, "Reviewed with Meta support");
    assert.ok(override.request.ruleIds.includes("personal-attributes-health"));
    assert.ok(override.request.ruleIds.includes("guaranteed-results"));
    assert.ok(audit.some((entry) => entry.result && entry.result.dryRun === true && /adcreatives/.test(entry.action)), "the dry run itself is still audited");

    // WARN prints and continues.
    const warn = spawnSync(process.execPath, [cli, "creatives", "create", JSON.stringify({ name: "Bake", pageId: "123", message: "Last chance for fresh sourdough.", link: "https://bakery.test" }), "--dry-run"], { encoding: "utf8", env });
    assert.strictEqual(warn.status, 0, warn.stderr);
    assert.match(warn.stderr, /WARN\s+false-urgency/);

    // Carousel creatives and campaign drafts are guarded too.
    const spec = JSON.stringify({ name: "Deck", pageId: "123", message: "Make $5,000 a week from home.", link: "https://site.test", cards: [{ imageHash: "abc", headline: "One" }, { imageHash: "def", headline: "Two" }] });
    const carousel = spawnSync(process.execPath, [cli, "creatives", "carousel", spec, "--dry-run"], { encoding: "utf8", env });
    assert.strictEqual(carousel.status, 2, carousel.stderr);
    assert.match(carousel.stderr, /income-claims/);
    const carouselOk = spawnSync(process.execPath, [cli, "creatives", "carousel", spec, "--dry-run", "--policy-override", "Testimonial with proof on page"], { encoding: "utf8", env });
    assert.strictEqual(carouselOk.status, 0, carouselOk.stderr);
    const draft = spawnSync(process.execPath, [cli, "draft-campaign", JSON.stringify({ offer: "Coaching", primaryText: "Tired of your belly fat? Join now." })], { encoding: "utf8", env });
    assert.strictEqual(draft.status, 2, draft.stderr);
    assert.match(draft.stderr, /draft-campaign refused/);

    // Writes off still wins over everything: no override reaches a live write.
    const live = spawnSync(process.execPath, [cli, "creatives", "create", creative, "--policy-override", "x"], { encoding: "utf8", env });
    assert.notStrictEqual(live.status, 0);
    assert.match(live.stderr, /writes disabled/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("enforcePolicy: PASS and WARN continue, BLOCK throws with exit code 2", () => {
  const logs = [];
  const log = (line) => logs.push(line);
  assert.strictEqual(policy.enforcePolicy({ action: "t", input: { message: "Fresh bread daily" }, log }).status, "PASS");
  assert.strictEqual(policy.enforcePolicy({ action: "t", input: { message: "Hurry in" }, log }).status, "WARN");
  assert.throws(() => policy.enforcePolicy({ action: "t", input: { message: "Get rich now" }, log }), (error) => error.exitCode === 2 && /income-claims/.test(error.message));
  const args = ["creatives", "create", "{}", "--policy-override", "ok by me"];
  assert.strictEqual(policy.takeOverrideArg(args), "ok by me");
  assert.deepStrictEqual(args, ["creatives", "create", "{}"]);
});

test("doctor warns when the policy guide is older than 90 days", async () => {
  const dir = tempDir("meta-ads-policy-doctor-");
  try {
    const stale = path.join(dir, "standards.md");
    fs.writeFileSync(stale, "# Guide\n\ncheckedOn: 2026-01-01\n");
    const guide = policy.standardsFreshness({ standardsPath: stale, now: new Date("2026-10-03T00:00:00Z") });
    assert.strictEqual(guide.ok, false);
    assert.match(guide.message, /more than 90/);
    const report = await readinessReport({ environment: {}, fileEnv: {}, integrity: { ok: true, changed: [], message: "ok" }, policyGuide: guide });
    assert.ok(report.warnings.some((warning) => /policy guide was last checked on 2026-01-01/.test(warning)));

    const shipped = policy.standardsFreshness({ now: new Date("2026-10-03T00:00:00Z") });
    assert.strictEqual(shipped.ok, true, shipped.message);
    assert.strictEqual(shipped.checkedOn, rulesFile.checkedOn, "guide and rules carry the same checked date");
    const missing = policy.standardsFreshness({ standardsPath: path.join(dir, "nope.md") });
    assert.strictEqual(missing.ok, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("recipes: policy check and rejected-ad fix", async () => {
  const check = require("../recipes/policy-check");
  const result = await check.runRecipe({ args: { text: "Are you in debt? Call us." } });
  assert.strictEqual(result.status, "blocked");
  assert.ok(result.metadata.findings.some((f) => f.ruleId === "personal-attributes-finances"));
  const clean = await check.runRecipe({ args: { creative: { message: "Explore guided breathing classes." } } });
  assert.strictEqual(clean.status, "ok");

  const fix = require("../recipes/rejected-ad-fix");
  const fixed = await fix.runRecipe({ args: { reason: "Your ad was rejected because it asserts or implies personal attributes.", text: "Are you struggling with anxiety? Book a call." } });
  assert.ok(fixed.metadata.mappedRuleIds.includes("personal-attributes-health"));
  assert.deepStrictEqual(fixed.metadata.findings.map((f) => f.ruleId), ["personal-attributes-health"]);
  assert.match(fixed.reply, /What to change/);
  const reasonOnly = await fix.runRecipe({ args: { reason: "Ad rejected: unrealistic income claims" } });
  assert.ok(reasonOnly.metadata.mappedRuleIds.includes("income-claims"));
  assert.match(reasonOnly.reply, /income-claims/);
  for (const name of ["policy-check", "rejected-ad-fix"]) {
    const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, `../recipes/${name}.recipe.json`), "utf8"));
    assert.strictEqual(manifest.handler, `./${name}.js`);
    assert.strictEqual(manifest.safety.destructive, false);
  }
});
