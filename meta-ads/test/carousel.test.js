const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "meta-carousel-"));
process.env.META_ADS_ACCESS_TOKEN = "test-token";
process.env.META_ADS_ACCOUNT_ID = "act_123";
process.env.META_ADS_AUDIT_LOG_PATH = path.join(tmp, "audit.jsonl");
const carousel = require("../src/carousel");
const api = require("../src/api-client");

function png(file, width = 1080, height = 1080) {
  const bytes = Buffer.alloc(33);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12);
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  bytes.write("IEND", 29);
  fs.writeFileSync(file, bytes);
  return bytes;
}

function base(cards = ["a", "b", "c"].map((name) => ({ imageHash: name.repeat(32).slice(0, 32), headline: name }))) {
  return { name: "Carousel", pageId: "123", instagramUserId: "456", message: "Primary message", link: "https://example.com", cards };
}

function response(body, { ok = true, status = 200 } = {}) {
  return { ok, status, headers: { get: () => null }, json: async () => body };
}

async function run() {
  const previousFetch = global.fetch;
  const previousWrites = process.env.META_ADS_WRITES_ENABLED;
  try {
    let fetchCalls = 0;
    global.fetch = async () => { fetchCalls += 1; throw new Error("unexpected network"); };
    const invalid = [
      [{ ...base([]) }, /2 to 10 cards/],
      [{ ...base([{ imageHash: "h", headline: "only" }]) }, /creatives create/],
      [{ ...base(Array.from({ length: 11 }, (_, i) => ({ imageHash: String(i), headline: "h" }))) }, /2 to 10 cards/],
      [{ ...base(Array.from({ length: 6 }, (_, i) => ({ imageHash: String(i), headline: "h" }))) }, /optimizeOrder/],
      [{ ...base([{ imageHash: "a", headline: "A" }, { imageHash: "b" }]) }, /Card 2 headline/],
      [{ ...base([{ headline: "A" }, { imageHash: "b", headline: "B" }]) }, /Card 1 must have exactly one/],
      [{ ...base([{ image: "/missing/no.png", imageHash: "h", headline: "A" }, { imageHash: "b", headline: "B" }]) }, /Card 1 must have exactly one/],
      [{ ...base(), link: "ftp://example.com" }, /http:\/\/ or https:\/\//],
      [{ ...base(), link: undefined }, /needs a valid http:\/\/ or https:\/\/ link/],
      [{ ...base(), pageId: "x" }, /pageId/],
      [{ ...base(), instagramUserId: "bad" }, /instagramUserId/],
      [{ ...base(), callToAction: "LIKE_PAGE" }, /LIKE_PAGE/],
      [{ ...base(), callToAction: "learn_more" }, /uppercase CTA/],
      [{ ...base(), title: "mistake" }, /headline/],
      [{ ...base(), dailyBudget: 100 }, /no budget/],
    ];
    for (const [spec, pattern] of invalid) assert.throws(() => carousel.validateCarouselSpec(spec), pattern);
    await assert.rejects(() => api.createCarouselCreative({ ...base([{ imageHash: "only", headline: "One" }]) }), /Carousel spec invalid/);
    assert.strictEqual(fetchCalls, 0);
    assert.strictEqual(fs.existsSync(process.env.META_ADS_AUDIT_LOG_PATH), false);

    const six = base(Array.from({ length: 6 }, (_, i) => ({ imageHash: String(i), headline: `h${i}` })));
    six.optimizeOrder = true;
    assert.strictEqual(carousel.validateCarouselSpec(six).spec.cards.length, 6);
    const warningSpec = base();
    delete warningSpec.instagramUserId;
    warningSpec.cards[0].imageHash = "not-hex";
    assert.ok(carousel.validateCarouselSpec(warningSpec).warnings.some((warning) => warning.includes("instagramUserId")));
    assert.ok(carousel.validateCarouselSpec(warningSpec).warnings.some((warning) => warning.includes("hexadecimal")));
    assert.throws(() => carousel.validateCarouselSpec({ cards: [{ headline: "" }], pageId: "x", unexpected: true }), (error) => {
      assert.match(error.message, /unknown key/);
      assert.match(error.message, /pageId/);
      assert.match(error.message, /headline/);
      return true;
    });

    const firstPath = path.join(tmp, "slide1.PNG");
    const secondPath = path.join(tmp, "slide2.png");
    const pngBytes = png(firstPath);
    png(secondPath, 500, 900);
    assert.throws(() => carousel.validateCarouselSpec(base([
      { image: path.join(tmp, "missing.png"), headline: "Missing" },
      { imageHash: "b", headline: "Two" },
    ])), /file not found/);
    const directory = path.join(tmp, "slides-dir.png");
    fs.mkdirSync(directory);
    assert.throws(() => carousel.validateCarouselSpec(base([
      { image: directory, headline: "Directory" },
      { imageHash: "b", headline: "Two" },
    ])), /regular file/);
    const gif = path.join(tmp, "slide.gif");
    fs.writeFileSync(gif, "gif");
    assert.throws(() => carousel.validateCarouselSpec(base([
      { image: gif, headline: "GIF" },
      { imageHash: "b", headline: "Two" },
    ])), /\.jpg, \.jpeg, or \.png/);
    const pathSpec = base([
      { image: firstPath, headline: "One" },
      { image: firstPath, headline: "Two" },
      { image: secondPath, headline: "Three" },
    ]);
    const failureSpec = base([
      { image: firstPath, headline: "One" },
      { image: secondPath, headline: "Two" },
    ]);
    assert.ok(carousel.validateCarouselSpec(pathSpec).warnings.some((warning) => warning.includes("not square")));
    const overrideSpec = carousel.validateCarouselSpec({
      ...base([
        { imageHash: "1".repeat(32), headline: "One", description: "Detail", link: "https://other.example", callToAction: "SHOP_NOW" },
        { imageHash: "2".repeat(32), headline: "Two" },
      ]),
      optimizeOrder: true,
      endCard: false,
    }).spec;
    const overrideBody = carousel.buildCarouselCreativeBody(overrideSpec, {}, { dryRun: false });
    assert.strictEqual(overrideBody.object_story_spec.link_data.multi_share_optimized, true);
    assert.strictEqual(overrideBody.object_story_spec.link_data.multi_share_end_card, false);
    assert.deepStrictEqual(overrideBody.object_story_spec.link_data.child_attachments[0].call_to_action, {
      type: "SHOP_NOW", value: { link: "https://other.example" },
    });
    assert.strictEqual(overrideBody.object_story_spec.link_data.child_attachments[0].description, "Detail");
    const omittedIdentity = carousel.buildCarouselCreativeBody({ ...overrideSpec, instagramUserId: undefined }, {}, { dryRun: false });
    assert.strictEqual(omittedIdentity.object_story_spec.instagram_user_id, undefined);
    delete process.env.META_ADS_WRITES_ENABLED;
    api.setDryRun(false);
    const dry = await api.createCarouselCreative(pathSpec, true);
    assert.strictEqual(dry.dryRun, true);
    assert.match(dry.id, /^dry_run_\d+$/);
    assert.strictEqual(dry.request.body.object_story_spec.link_data.child_attachments[0].image_hash, "DRY_RUN_HASH_1");
    assert.strictEqual(fetchCalls, 0);
    const auditLines = fs.readFileSync(process.env.META_ADS_AUDIT_LOG_PATH, "utf8").trim().split("\n");
    assert.strictEqual(auditLines.length, 3); // two unique uploads and one creative request
    for (const line of auditLines) {
      assert.ok(line.length < 5000);
      assert.ok(!line.includes(pngBytes.toString("base64")));
      assert.strictEqual(JSON.parse(line).result.dryRun, true);
    }
    const uploadedAudit = JSON.parse(auditLines[0]);
    assert.strictEqual(uploadedAudit.request.body.byteSize, pngBytes.length);
    assert.strictEqual(uploadedAudit.request.body.sha256, require("crypto").createHash("sha256").update(pngBytes).digest("hex"));

    if (fs.existsSync(process.env.META_ADS_AUDIT_LOG_PATH)) fs.unlinkSync(process.env.META_ADS_AUDIT_LOG_PATH);
    await assert.rejects(() => api.createCarouselCreative(base(), false), /writes disabled/);
    assert.strictEqual(fetchCalls, 0);
    assert.strictEqual(fs.existsSync(process.env.META_ADS_AUDIT_LOG_PATH), false);
    await assert.rejects(() => api.createCarouselCreative(failureSpec, false), /Card 1 image upload failed: writes disabled/);
    assert.strictEqual(fetchCalls, 0);
    assert.strictEqual(fs.existsSync(process.env.META_ADS_AUDIT_LOG_PATH), false);

    process.env.META_ADS_WRITES_ENABLED = "true";
    const requests = [];
    global.fetch = async (url, options) => {
      fetchCalls += 1;
      const route = new URL(url).pathname;
      requests.push({ route, body: JSON.parse(options.body) });
      if (route.endsWith("/adimages")) return response({ images: { slide: { hash: "a".repeat(32) } } });
      return response({ id: "creative-123" });
    };
    if (fs.existsSync(process.env.META_ADS_AUDIT_LOG_PATH)) fs.unlinkSync(process.env.META_ADS_AUDIT_LOG_PATH);
    const result = await api.createCarouselCreative(base([
      { image: firstPath, headline: "One" },
      { imageHash: "b".repeat(32), headline: "Two" },
      { image: secondPath, headline: "Three" },
    ]));
    assert.strictEqual(result.creativeId, "creative-123");
    assert.deepStrictEqual(requests.map((request) => request.route), [
      "/v25.0/act_123/adimages", "/v25.0/act_123/adimages", "/v25.0/act_123/adcreatives",
    ]);
    const creativeBody = requests[2].body;
    assert.deepStrictEqual(creativeBody, {
      name: "Carousel",
      object_story_spec: {
        page_id: "123",
        instagram_user_id: "456",
        link_data: {
          message: "Primary message",
          link: "https://example.com",
          call_to_action: { type: "LEARN_MORE", value: { link: "https://example.com" } },
          child_attachments: [
            { link: "https://example.com", image_hash: "a".repeat(32), name: "One", call_to_action: { type: "LEARN_MORE", value: { link: "https://example.com" } } },
            { link: "https://example.com", image_hash: "b".repeat(32), name: "Two", call_to_action: { type: "LEARN_MORE", value: { link: "https://example.com" } } },
            { link: "https://example.com", image_hash: "a".repeat(32), name: "Three", call_to_action: { type: "LEARN_MORE", value: { link: "https://example.com" } } },
          ],
          multi_share_optimized: false,
          multi_share_end_card: true,
        },
      },
    });
    assert.strictEqual(requests[0].body.bytes, pngBytes.toString("base64"));
    assert.strictEqual(requests[0].body.name, "slide1.PNG");
    assert.strictEqual(requests[2].body.image_url, undefined);
    assert.strictEqual(requests[2].body.degrees_of_freedom_spec, undefined);
    const realAudit = fs.readFileSync(process.env.META_ADS_AUDIT_LOG_PATH, "utf8");
    assert.ok(!realAudit.includes("test-token"));
    assert.ok(!realAudit.includes(pngBytes.toString("base64")));
    assert.ok(realAudit.includes("a".repeat(32)), "audit response should retain the returned image hash");

    fetchCalls = 0;
    global.fetch = async (url) => {
      fetchCalls += 1;
      if (new URL(url).pathname.endsWith("/adimages")) {
        return fetchCalls === 1
          ? response({ images: { slide: { hash: "a".repeat(32) } } })
          : response({ error: { message: "bad image", code: 100 } }, { ok: false, status: 400 });
      }
      throw new Error("creative request must not follow a failed upload");
    };
    await assert.rejects(() => api.createCarouselCreative(failureSpec), /Card 2 image upload failed.*card 1 ->/);
    assert.strictEqual(fetchCalls, 2);

    fetchCalls = 0;
    global.fetch = async (url) => {
      fetchCalls += 1;
      if (new URL(url).pathname.endsWith("/adimages")) return response({ images: {} });
      throw new Error("creative request must not follow a missing hash");
    };
    await assert.rejects(() => api.createCarouselCreative(failureSpec), /Card 1 image upload returned no image hash/);
    assert.strictEqual(fetchCalls, 1);

    const recipe = require("../recipes/create-carousel-creative");
    if (fs.existsSync(process.env.META_ADS_AUDIT_LOG_PATH)) fs.unlinkSync(process.env.META_ADS_AUDIT_LOG_PATH);
    delete process.env.META_ADS_WRITES_ENABLED;
    const recipeDry = await recipe.runRecipe({ spec: base() });
    assert.strictEqual(recipeDry.status, "dry_run");
    assert.strictEqual(recipeDry.metadata.dryRun, true);
    assert.strictEqual(fs.existsSync(process.env.META_ADS_AUDIT_LOG_PATH), true);
    fs.unlinkSync(process.env.META_ADS_AUDIT_LOG_PATH);
    await assert.rejects(() => recipe.runRecipe({ spec: base(), dryRun: false }), /writes disabled/);
  } finally {
    global.fetch = previousFetch;
    api.setDryRun(false);
    if (previousWrites === undefined) delete process.env.META_ADS_WRITES_ENABLED;
    else process.env.META_ADS_WRITES_ENABLED = previousWrites;
  }
}

run().then(() => console.log("carousel.test.js passed")).catch((error) => {
  process.stderr.write(`${error?.stack || String(error)}\n`);
  process.exitCode = 1;
});
