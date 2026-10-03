const assert = require("assert");
const fs = require("fs");
const Module = require("module");
const os = require("os");
const path = require("path");

const FAKE_TOKEN = "EAAfaketoken1234567890";
const FAKE_SECRET = "fakeappsecret0987654321";
const auditDir = fs.mkdtempSync(path.join(os.tmpdir(), "meta-ads-redaction-"));
process.env.META_ADS_AUDIT_LOG_PATH = path.join(auditDir, "audit.jsonl");
process.env.META_ADS_ACCESS_TOKEN = FAKE_TOKEN;
process.env.META_ADS_APP_SECRET = FAKE_SECRET;
process.env.META_ADS_ACCOUNT_ID = "act_123";

const originalLoad = Module._load;
Module._load = function loadModule(request, parent, isMain) {
  if (request === "dotenv") return { config: () => ({ parsed: {} }) };
  return originalLoad.call(this, request, parent, isMain);
};

const { redactString, redactValue, redactError, credentialValues } = require("../src/redact");
const { writeAudit } = require("../src/audit-log");
const api = require("../src/api-client");

function response(body, { ok = true, status = 200 } = {}) {
  return { ok, status, headers: { get: () => null }, json: async () => body };
}

const pagingNext = `https://graph.facebook.com/v25.0/act_123/campaigns?access_token=${FAKE_TOKEN}&appsecret_proof=${FAKE_SECRET}&fields=id&after=QVFI123`;

async function run() {
  const previousFetch = global.fetch;
  try {
    // Layer 1: named query parameters lose their value whatever it is.
    assert.strictEqual(redactString("https://x/y?access_token=abc&fields=id"), "https://x/y?access_token=<redacted>&fields=id");
    assert.strictEqual(redactString("a=1&client_secret=zzz#frag"), "a=1&client_secret=<redacted>#frag");
    assert.strictEqual(redactString("appsecret_proof=deadbeef"), "appsecret_proof=<redacted>");
    // Layer 2: configured credential values, raw and URL-encoded.
    assert.strictEqual(redactString(`token is ${FAKE_TOKEN}.`), "token is <redacted>.");
    assert.strictEqual(redactString(`secret ${FAKE_SECRET} here`), "secret <redacted> here");
    assert.strictEqual(redactString(`x=${encodeURIComponent("EAA|pipe")}`, { META_ADS_ACCESS_TOKEN: "EAA|pipe" }), "x=<redacted>");
    // Short values are not treated as secrets (would blank ordinary letters).
    assert.deepStrictEqual(credentialValues({ META_ADS_ACCESS_TOKEN: "ab" }), []);
    assert.strictEqual(redactString("abc", { META_ADS_ACCESS_TOKEN: "ab" }), "abc");
    assert.strictEqual(redactString(""), "");
    assert.strictEqual(redactString(null), null);

    // Recursive walk, paging reduction, key-based redaction, cycle safety.
    const circular = { name: "loop" };
    circular.self = circular;
    const payload = {
      data: [{ id: "1", note: `see ${FAKE_TOKEN}` }, [`nested ${FAKE_SECRET}`]],
      paging: { cursors: { before: "B1", after: "QVFI123" }, next: pagingNext, previous: pagingNext.replace("after=QVFI123", "before=B1") },
      access_token: "whatever",
      client_secret: "x",
      nested: { app_secret: "y", keep: "value", url: `https://example.com/?x=1&access_token=${FAKE_TOKEN}` },
      circular,
      count: 3,
      nothing: null,
    };
    const redacted = redactValue(payload);
    assert.deepStrictEqual(redacted.data, [{ id: "1", note: "see <redacted>" }, ["nested <redacted>"]]);
    assert.deepStrictEqual(redacted.paging.cursors, { before: "B1", after: "QVFI123" }, "cursors are kept");
    assert.strictEqual(redacted.paging.next, "<redacted url; next page cursor paging.cursors.after=QVFI123>");
    assert.strictEqual(redacted.paging.previous, "<redacted url; next page cursor paging.cursors.before=B1>");
    assert.strictEqual(redacted.access_token, "<redacted>");
    assert.strictEqual(redacted.client_secret, "<redacted>");
    assert.strictEqual(redacted.nested.app_secret, "<redacted>");
    assert.strictEqual(redacted.nested.keep, "value");
    assert.strictEqual(redacted.nested.url, "https://example.com/?x=1&access_token=<redacted>");
    assert.strictEqual(redacted.circular.self, "<circular>");
    assert.strictEqual(redacted.count, 3);
    assert.strictEqual(redacted.nothing, null);
    assert.doesNotMatch(JSON.stringify(redacted), new RegExp(FAKE_TOKEN));
    assert.doesNotMatch(JSON.stringify(redacted), new RegExp(FAKE_SECRET));
    // The input is not mutated (pagination still has the raw URL internally).
    assert.strictEqual(payload.paging.next, pagingNext);
    // Redacting twice (api-client boundary, then the CLI printer) is a no-op.
    assert.deepStrictEqual(redactValue(redacted), redacted);

    const error = redactError(new Error(`Meta API Error: bad ${FAKE_TOKEN} (code 190)`));
    assert.strictEqual(error.message, "Meta API Error: bad <redacted> (code 190)");

    // Audit log: values are redacted regardless of key names.
    writeAudit("POST /c1", { endpoint: "/c1", body: { status: "PAUSED" } }, { success: true, debug: pagingNext, token_copy: FAKE_TOKEN });
    const auditText = fs.readFileSync(process.env.META_ADS_AUDIT_LOG_PATH, "utf8");
    assert.doesNotMatch(auditText, new RegExp(FAKE_TOKEN));
    assert.doesNotMatch(auditText, new RegExp(FAKE_SECRET));
    assert.match(auditText, /"token_copy":"<redacted>"/);

    // API client: pagination still follows the raw next URL, output is redacted.
    let calls = 0;
    global.fetch = async (url) => {
      calls += 1;
      const requested = new URL(url);
      assert.strictEqual(requested.searchParams.get("access_token"), FAKE_TOKEN, "request itself still carries the real token");
      return calls === 1
        ? response({ data: [{ id: "one" }], paging: { cursors: { after: "QVFI123" }, next: pagingNext } })
        : response({ data: [{ id: "two", link: `https://graph.facebook.com/?access_token=${FAKE_TOKEN}` }], paging: { cursors: { before: "QVFI123" }, previous: pagingNext } });
    };
    const campaigns = await api.listCampaigns();
    assert.strictEqual(calls, 2, "both pages are fetched");
    assert.deepStrictEqual(campaigns.data.map((row) => row.id), ["one", "two"]);
    assert.strictEqual(campaigns.data[1].link, "https://graph.facebook.com/?access_token=<redacted>");
    assert.match(campaigns.paging.previous, /^<redacted url/);
    assert.doesNotMatch(JSON.stringify(campaigns), new RegExp(FAKE_TOKEN));

    // Single-request path and error path.
    global.fetch = async () => response({ id: "c1", paging: { next: pagingNext } });
    const single = await api.apiCall("/c1");
    assert.match(single.paging.next, /^<redacted url; next page cursor paging\.cursors\.after=QVFI123>$/);
    global.fetch = async () => response({ error: { message: `Invalid OAuth access token ${FAKE_TOKEN} via ${pagingNext}`, code: 190 } }, { ok: false, status: 400 });
    await assert.rejects(() => api.apiCall("/c1"), (err) => {
      assert.match(err.message, /Meta API Error: Invalid OAuth access token <redacted> via https:\/\/graph\.facebook\.com\/v25\.0\/act_123\/campaigns\?access_token=<redacted>&appsecret_proof=<redacted>&fields=id&after=QVFI123 \(code 190\)/);
      assert.doesNotMatch(err.message, new RegExp(FAKE_TOKEN));
      assert.doesNotMatch(err.message, new RegExp(FAKE_SECRET));
      return true;
    });
  } finally {
    global.fetch = previousFetch;
    Module._load = originalLoad;
    fs.rmSync(auditDir, { recursive: true, force: true });
  }
}

run()
  .then(() => console.log("redaction.test.js passed"))
  .catch((error) => { console.error(error); process.exit(1); });
