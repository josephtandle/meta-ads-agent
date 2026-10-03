// Tamper evidence: config/src-checksums.json must match the installed src/ and
// recipes/ files (this test fails when the manifest is stale), doctor must
// report drift in plain language, and the assistant guidance files must ship.
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const agentRoot = path.join(__dirname, "..");
const { checkSrcIntegrity, computeSrcChecksums, DIFFER_MESSAGE, CHECKSUM_PATH } = require("../src/integrity");
const { readinessReport } = require("../src/readiness");

async function run() {
  // 1. Shipped manifest is current. If this fails, run: node scripts/write-src-checksums.js
  const shipped = JSON.parse(fs.readFileSync(CHECKSUM_PATH, "utf8"));
  const current = computeSrcChecksums(agentRoot);
  assert.deepStrictEqual(current.files, shipped.files, "config/src-checksums.json is stale; run node scripts/write-src-checksums.js as the last step of the change");
  const live = checkSrcIntegrity();
  assert.deepStrictEqual(live, { ok: true, changed: [], message: live.message });
  assert.match(live.message, /match their checksums/);
  for (const file of ["src/api-client.js", "src/recipe-helpers.js", "src/index.js", "src/redact.js", "src/integrity.js", "recipes/pause-campaign.js"]) {
    assert.ok(shipped.files[file], `${file} must be covered by the manifest`);
  }
  assert.ok(!Object.keys(shipped.files).some((file) => /\.bak/.test(file)), "backup files are not shipped files");
  const check = spawnSync(process.execPath, [path.join(agentRoot, "scripts/write-src-checksums.js"), "--check"], { encoding: "utf8" });
  assert.strictEqual(check.status, 0, check.stdout + check.stderr);

  // 2. A tampered copy is reported, with the file named.
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "meta-ads-integrity-"));
  try {
    for (const dir of ["src", "recipes", "config"]) fs.cpSync(path.join(agentRoot, dir), path.join(tempRoot, dir), { recursive: true });
    const tempChecksums = path.join(tempRoot, "config/src-checksums.json");
    assert.strictEqual(checkSrcIntegrity({ root: tempRoot, checksumPath: tempChecksums }).ok, true);

    const gate = path.join(tempRoot, "src/recipe-helpers.js");
    fs.writeFileSync(gate, fs.readFileSync(gate, "utf8").replace('process.env.META_ADS_WRITES_ENABLED !== "true"', "false"));
    fs.writeFileSync(path.join(tempRoot, "recipes/evil.js"), "module.exports = {};\n");
    fs.rmSync(path.join(tempRoot, "src/redact.js"));
    const tampered = checkSrcIntegrity({ root: tempRoot, checksumPath: tempChecksums });
    assert.strictEqual(tampered.ok, false);
    assert.deepStrictEqual(tampered.changed, ["recipes/evil.js (added)", "src/recipe-helpers.js", "src/redact.js (missing)"]);
    assert.strictEqual(tampered.message, DIFFER_MESSAGE);
    assert.match(tampered.message, /src files differ from the shipped version; the safety gates may have been edited/);

    const missingManifest = checkSrcIntegrity({ root: tempRoot, checksumPath: path.join(tempRoot, "nope.json") });
    assert.strictEqual(missingManifest.ok, false);
    assert.match(missingManifest.message, /missing or unreadable/);

    // doctor carries the block through unchanged.
    const report = await readinessReport({ environment: {}, fileEnv: {}, apiClient: { apiCall: async () => { throw new Error("no network"); } }, integrity: tampered });
    assert.deepStrictEqual(report.integrity, tampered);
    const healthy = await readinessReport({ environment: {}, fileEnv: {}, apiClient: { apiCall: async () => { throw new Error("no network"); } } });
    assert.strictEqual(healthy.integrity.ok, true);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }

  // 3. Guidance files for coding assistants: present, identical, short, on point.
  const claude = fs.readFileSync(path.join(agentRoot, "CLAUDE.md"), "utf8");
  const agents = fs.readFileSync(path.join(agentRoot, "AGENTS.md"), "utf8");
  assert.strictEqual(claude, agents, "CLAUDE.md and AGENTS.md must be identical");
  assert.ok(claude.trim().split("\n").length < 60, "guidance stays under 60 lines");
  for (const phrase of [".env", "META_ADS_WRITES_ENABLED=true", "--dry-run", "META_ADS_MAX_DAILY_BUDGET_CENTS", "src-checksums.json", "Never edit anything under `src/` or `config/`", "policy check", "PAUSED", "audit log-external", "doctor", "docs/CONNECTOR-MODE.md"]) {
    assert.ok(claude.includes(phrase), `guidance must mention ${phrase}`);
  }
  assert.ok(!claude.includes(String.fromCharCode(0x2014)), "no em dashes");
}

run()
  .then(() => console.log("integrity.test.js passed"))
  .catch((error) => { console.error(error); process.exit(1); });
