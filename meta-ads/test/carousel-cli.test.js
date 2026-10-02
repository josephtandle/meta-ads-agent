const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "meta-carousel-cli-"));
const hookPath = path.join(temp, "fetch-hook.cjs");
const cli = path.join(root, "src/index.js");

fs.writeFileSync(hookPath, `
const fs = require("fs");
global.fetch = async (url, options) => {
  const pathname = new URL(url).pathname;
  const body = options.body ? JSON.parse(options.body) : null;
  if (process.env.META_ADS_NETWORK_ATTEMPT_PATH) fs.appendFileSync(process.env.META_ADS_NETWORK_ATTEMPT_PATH, pathname + "\\n");
  if (process.env.META_ADS_FAKE_GRAPH_LOG) fs.appendFileSync(process.env.META_ADS_FAKE_GRAPH_LOG, JSON.stringify({ pathname, body }) + "\\n");
  if (!process.env.META_ADS_FAKE_GRAPH_LOG) throw new Error("blocked test network request");
  if (pathname.endsWith("/adimages")) return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ images: { uploaded: { hash: "a".repeat(32) } } }) };
  if (pathname.endsWith("/adcreatives")) return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ id: "creative-cli-123" }) };
  throw new Error("unexpected mocked endpoint: " + pathname);
};
`);

function spec(cards) {
  return { name: "CLI carousel", pageId: "123", message: "Message", link: "https://example.com", cards };
}

function hashSpec() {
  return spec(["1", "2", "3"].map((value) => ({ imageHash: value.repeat(32), headline: `Slide ${value}` })));
}

function png(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const data = Buffer.alloc(33);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(data);
  data.writeUInt32BE(13, 8);
  data.write("IHDR", 12);
  data.writeUInt32BE(1080, 16);
  data.writeUInt32BE(1080, 20);
  data.write("IEND", 29);
  fs.writeFileSync(file, data);
  return data;
}

function invoke(args, { cwd = temp, writes = "false", fakeGraph = false, credentials = true, auditPath = path.join(temp, "audit.jsonl"), attemptPath = path.join(temp, "attempts.log") } = {}) {
  const env = {
    ...process.env,
    META_ADS_ACCESS_TOKEN: credentials ? "test-token" : "",
    META_ADS_ACCOUNT_ID: credentials ? "act_123" : "",
    META_ADS_WRITES_ENABLED: writes,
    META_ADS_AUDIT_LOG_PATH: auditPath,
    META_ADS_NETWORK_ATTEMPT_PATH: attemptPath,
    NODE_OPTIONS: `--require=${hookPath}`,
  };
  if (fakeGraph) env.META_ADS_FAKE_GRAPH_LOG = path.join(temp, "graph.jsonl");
  else delete env.META_ADS_FAKE_GRAPH_LOG;
  return spawnSync(process.execPath, [cli, ...args], { cwd, env, encoding: "utf8" });
}

function resetFiles(...files) {
  for (const file of files) if (fs.existsSync(file)) fs.unlinkSync(file);
}

async function run() {
  const audit = path.join(temp, "audit.jsonl");
  const attempts = path.join(temp, "attempts.log");
  const graphLog = path.join(temp, "graph.jsonl");
  try {
    let result = invoke(["creatives", "carousel"]);
    assert.notStrictEqual(result.status, 0);
    assert.match(result.stderr, /Usage: creatives carousel/);
    assert.strictEqual(fs.existsSync(attempts), false);

    for (const args of [["creatives"], ["creatives", "bogus"]]) {
      result = invoke(args);
      assert.notStrictEqual(result.status, 0);
      assert.match(result.stderr, /Usage:/);
    }

    const invalidPath = path.join(temp, "invalid.json");
    fs.writeFileSync(invalidPath, JSON.stringify(spec([{ imageHash: "a", headline: "" }])));
    resetFiles(audit, attempts);
    result = invoke(["creatives", "carousel", invalidPath]);
    assert.notStrictEqual(result.status, 0);
    assert.match(result.stderr, /at least 2 cards/);
    assert.match(result.stderr, /Card 1 headline/);
    assert.strictEqual(fs.existsSync(attempts), false);
    assert.strictEqual(fs.existsSync(audit), false);

    const validHashPath = path.join(temp, "hashes.json");
    fs.writeFileSync(validHashPath, JSON.stringify(hashSpec()));
    result = invoke(["creatives", "carousel", validHashPath], { writes: "false" });
    assert.notStrictEqual(result.status, 0);
    assert.match(result.stderr, /writes disabled/);
    assert.strictEqual(fs.existsSync(attempts), false);
    assert.strictEqual(fs.existsSync(audit), false);

    resetFiles(audit, attempts);
    result = invoke(["creatives", "carousel", "--dry-run", validHashPath]);
    assert.strictEqual(result.status, 0, result.stderr);
    let parsed = JSON.parse(result.stdout);
    assert.strictEqual(parsed.dryRun, true);
    assert.strictEqual(parsed.request.body.object_story_spec.link_data.child_attachments.length, 3);
    assert.match(result.stdout, /"dryRun": true/);
    assert.strictEqual(fs.existsSync(attempts), false);

    resetFiles(audit, attempts);
    result = invoke(["creatives", "carousel", validHashPath, "--dry-run"]);
    assert.strictEqual(result.status, 0, result.stderr);
    assert.strictEqual(JSON.parse(result.stdout).dryRun, true);

    const project = path.join(temp, "project");
    const specPath = path.join(project, "carousel.json");
    const p1 = png(path.join(project, "slides", "one.png"));
    png(path.join(project, "slides", "two.png"));
    png(path.join(project, "slides", "three.png"));
    fs.writeFileSync(specPath, JSON.stringify(spec([
      { image: "./slides/one.png", headline: "One" },
      { image: "./slides/two.png", headline: "Two" },
      { image: "./slides/three.png", headline: "Three" },
    ])));
    resetFiles(audit, attempts);
    result = invoke(["creatives", "carousel", specPath, "--dry-run"], { cwd: temp, credentials: false, writes: "false" });
    assert.strictEqual(result.status, 0, result.stderr);
    assert.match(result.stdout, /DRY_RUN_HASH_1/);
    assert.match(result.stdout, /DRY_RUN_HASH_2/);
    assert.match(result.stdout, /DRY_RUN_HASH_3/);
    assert.match(result.stdout, /act_<ACCOUNT_ID>\/adcreatives/);
    assert.strictEqual(fs.existsSync(attempts), false);
    const dryAudit = fs.readFileSync(audit, "utf8");
    assert.strictEqual(dryAudit.trim().split("\n").length, 4);
    assert.ok(!dryAudit.includes(p1.toString("base64")));

    resetFiles(audit, attempts);
    const inline = invoke(["creatives", "carousel", JSON.stringify(hashSpec()), "--dry-run"]);
    assert.strictEqual(inline.status, 0, inline.stderr);
    assert.strictEqual(JSON.parse(inline.stdout).dryRun, true);

    resetFiles(audit, attempts);
    const example = invoke(["creatives", "carousel", "--example"]);
    assert.strictEqual(example.status, 0, example.stderr);
    const exampleSpec = JSON.parse(example.stdout);
    exampleSpec.cards = exampleSpec.cards.map((card, index) => ({ imageHash: String(index + 1).repeat(32), headline: card.headline }));
    require("../src/carousel").validateCarouselSpec(exampleSpec);
    assert.strictEqual(fs.existsSync(audit), false);

    resetFiles(audit, attempts, graphLog);
    const endToEnd = invoke(["creatives", "carousel", specPath], { cwd: temp, writes: "true", fakeGraph: true });
    assert.strictEqual(endToEnd.status, 0, endToEnd.stderr);
    parsed = JSON.parse(endToEnd.stdout);
    assert.strictEqual(parsed.creativeId, "creative-cli-123");
    assert.strictEqual(parsed.dryRun, false);
    const requests = fs.readFileSync(graphLog, "utf8").trim().split("\n").map(JSON.parse);
    assert.deepStrictEqual(requests.map((request) => request.pathname), [
      "/v25.0/act_123/adimages", "/v25.0/act_123/adimages", "/v25.0/act_123/adimages", "/v25.0/act_123/adcreatives",
    ]);
    assert.deepStrictEqual(requests.slice(0, 3).map((request) => request.body.name), ["one.png", "two.png", "three.png"]);
    assert.deepStrictEqual(requests[3].body.object_story_spec.link_data.child_attachments.map((card) => card.name), ["One", "Two", "Three"]);
    assert.strictEqual(requests[3].body.object_story_spec.link_data.multi_share_optimized, false);
    assert.strictEqual(fs.existsSync(attempts), true);

    const creativeDry = invoke(["creatives", "create", JSON.stringify({ name: "Single", pageId: "123", message: "M", link: "https://example.com", imageHash: "hash" }), "--dry-run"], { writes: "true" });
    assert.strictEqual(creativeDry.status, 0, creativeDry.stderr);
    assert.match(creativeDry.stdout, /"dryRun": true/);
    assert.strictEqual(fs.existsSync(attempts), true);
  } finally {
    // Keep generated files isolated to the OS temp directory.
  }
}

run().then(() => console.log("carousel-cli.test.js passed")).catch((error) => { console.error(error); process.exit(1); });
