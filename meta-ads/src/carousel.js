const fs = require("fs");
const path = require("path");

const MIN_CARDS = 2;
const MAX_CARDS = 10;
const MAX_UNOPTIMIZED_CARDS = 5;
const MAX_IMAGE_BYTES = 30 * 1024 * 1024;
const TOP_LEVEL_KEYS = new Set(["name", "pageId", "instagramUserId", "message", "link", "callToAction", "optimizeOrder", "endCard", "cards"]);
const CARD_KEYS = new Set(["image", "imageHash", "headline", "description", "link", "callToAction"]);

function loadCarouselSpec(input, { cwd = process.cwd(), readFileSync = fs.readFileSync } = {}) {
  if (typeof input !== "string" || !input.trim()) throw new Error("Usage: creatives carousel <spec.json|'<json>'> [--dry-run]");
  let spec;
  let baseDir = cwd;
  if (input.trimStart().startsWith("{")) {
    spec = JSON.parse(input);
  } else {
    const specPath = path.resolve(cwd, input);
    spec = JSON.parse(readFileSync(specPath, "utf8"));
    baseDir = path.dirname(specPath);
  }
  if (spec && Array.isArray(spec.cards)) {
    spec = { ...spec, cards: spec.cards.map((card) => (
      typeof card?.image === "string" && !/^https?:\/\//i.test(card.image)
        ? { ...card, image: path.resolve(baseDir, card.image) }
        : card
    )) };
  }
  return spec;
}

function imageDimensions(buffer) {
  if (buffer.length >= 24 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) { offset += 1; continue; }
    const marker = buffer[offset + 1];
    const length = buffer.readUInt16BE(offset + 2);
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
    }
    if (length < 2) break;
    offset += 2 + length;
  }
  return null;
}

function unknownKeyMessage(key, cardNumber = null) {
  const suggestions = { title: "headline", hash: "imageHash", path: "image", file: "image", cta: "callToAction", text: "message", primaryText: "message", url: "link" };
  const prefix = cardNumber ? `Card ${cardNumber}: ` : "";
  if (["dailyBudget", "daily_budget", "lifetimeBudget"].includes(key)) return `${prefix}${key} is not supported: carousel creatives have no budget; set it on the ad set`;
  return `${prefix}unknown key "${key}"${suggestions[key] ? `; use "${suggestions[key]}"` : ""}`;
}

function validateCarouselSpec(input, { existsSync = fs.existsSync, statSync = fs.statSync, readFileSync = fs.readFileSync } = {}) {
  const errors = [];
  const warnings = [];
  const spec = input && typeof input === "object" && !Array.isArray(input) ? { ...input } : {};
  for (const key of Object.keys(spec)) if (!TOP_LEVEL_KEYS.has(key)) errors.push(unknownKeyMessage(key));

  if (typeof spec.name !== "string" || !spec.name.trim()) errors.push("name is required");
  if (typeof spec.message !== "string" || !spec.message.trim()) errors.push("message is required");
  if (typeof spec.pageId !== "string" || !/^\d+$/.test(spec.pageId)) errors.push("pageId is required and must contain digits only");
  if (spec.instagramUserId != null && !/^\d+$/.test(String(spec.instagramUserId))) errors.push("instagramUserId must contain digits only");
  if (spec.instagramUserId == null) warnings.push("instagramUserId is missing; the ad will run as the Page only. See runbook Part 1 step 5.");
  if (spec.callToAction != null && (!/^[A-Z][A-Z_]+$/.test(spec.callToAction) || spec.callToAction === "LIKE_PAGE")) errors.push("callToAction must be a supported uppercase CTA and cannot be LIKE_PAGE");

  let defaultLink = spec.link;
  if (defaultLink != null && !validLink(defaultLink)) errors.push("link must be a valid http:// or https:// URL");
  if (typeof defaultLink === "string" && defaultLink.startsWith("http://")) warnings.push("The default link uses HTTP; HTTPS is recommended.");
  if (spec.link == null && Array.isArray(spec.cards) && typeof spec.cards[0]?.link === "string") defaultLink = spec.cards[0].link;

  if (!Array.isArray(spec.cards)) errors.push("cards must be an array of 2 to 10 cards");
  else {
    if (spec.cards.length === 1) errors.push("a carousel needs at least 2 cards; for a single image use creatives create (and images upload)");
    else if (spec.cards.length < MIN_CARDS || spec.cards.length > MAX_CARDS) errors.push("cards must contain 2 to 10 cards");
    if (spec.cards.length > MAX_UNOPTIMIZED_CARDS && spec.optimizeOrder !== true) errors.push("6 to 10 cards require optimizeOrder: true (Meta lets Facebook auto-order them; Instagram still shows only the first 5)");
    if (spec.cards.length > 5) warnings.push("Instagram uses only the first 5 cards.");
    if (spec.cards.length < 3 && spec.cards.length >= 2) warnings.push("Facebook recommends 3 or more cards.");
    const hosts = [];
    spec.cards = spec.cards.map((cardValue, index) => {
      const card = cardValue && typeof cardValue === "object" && !Array.isArray(cardValue) ? { ...cardValue } : {};
      const label = `Card ${index + 1}`;
      for (const key of Object.keys(card)) if (!CARD_KEYS.has(key)) errors.push(unknownKeyMessage(key, index + 1));
      const hasImage = typeof card.image === "string" && card.image.length > 0;
      const hasHash = typeof card.imageHash === "string" && card.imageHash.length > 0;
      if (hasImage === hasHash) errors.push(`${label} must have exactly one of image or imageHash`);
      if (typeof card.headline !== "string" || !card.headline.trim()) errors.push(`${label} headline is required`);
      if (card.headline?.length > 40) warnings.push(`${label} headline is longer than 40 characters.`);
      const link = card.link || defaultLink;
      if (!validLink(link)) errors.push(`${label} needs a valid http:// or https:// link`);
      else {
        if (link.startsWith("http://")) warnings.push(`${label} link uses HTTP; HTTPS is recommended.`);
        try { hosts.push(new URL(link).host); } catch { /* validLink reports the error */ }
      }
      if (card.callToAction != null && (!/^[A-Z][A-Z_]+$/.test(card.callToAction) || card.callToAction === "LIKE_PAGE")) errors.push(`${label} callToAction must be a supported uppercase CTA and cannot be LIKE_PAGE`);
      if (hasHash && !/^[0-9a-f]{32}$/.test(card.imageHash)) warnings.push(`${label} imageHash is not a 32-character lowercase hexadecimal value.`);
      if (hasImage && !/^https?:\/\//i.test(card.image)) {
        const extension = path.extname(card.image).toLowerCase();
        if (!existsSync(card.image)) errors.push(`${label} image file not found: ${card.image}`);
        else {
          let stat;
          try { stat = statSync(card.image); } catch { errors.push(`${label} image file could not be read: ${card.image}`); }
          if (stat && !stat.isFile()) errors.push(`${label} image must be a regular file, not a directory`);
          if (!new Set([".jpg", ".jpeg", ".png"]).has(extension)) errors.push(`${label} image must use .jpg, .jpeg, or .png`);
          if (stat?.size > MAX_IMAGE_BYTES) errors.push(`${label} image exceeds the 30 MB limit`);
          if (stat?.isFile()) {
            try {
              const dimensions = imageDimensions(readFileSync(card.image));
              if (dimensions && (dimensions.width < 600 || dimensions.height < 600)) warnings.push(`${label} image is below 600x600 pixels.`);
              if (dimensions && dimensions.width !== dimensions.height) warnings.push(`${label} image is not square.`);
            } catch { /* upload path emits the read error */ }
          }
        }
      } else if (hasImage) warnings.push(`${label} uses a remote image URL; URL fetching may not be available, local paths are preferred.`);
      return { ...card, link };
    });
    if (new Set(hosts).size > 1 && typeof spec.link === "string") warnings.push("One or more card links use a different host from the default link.");
  }
  if (spec.message?.length > 125) warnings.push("Primary message is longer than 125 characters.");
  warnings.push("Carousel headlines and descriptions may not render on Instagram; put the message in each slide image.");

  if (errors.length) throw new Error(`Carousel spec invalid:\n${errors.map((error) => `- ${error}`).join("\n")}`);
  spec.link = defaultLink || spec.cards[0].link;
  spec.callToAction = spec.callToAction || "LEARN_MORE";
  spec.optimizeOrder = spec.optimizeOrder === true;
  spec.endCard = spec.endCard !== false;
  return { spec, warnings };
}

function validLink(value) {
  if (typeof value !== "string") return false;
  try { return ["http:", "https:"].includes(new URL(value).protocol); } catch { return false; }
}

function buildCarouselCreativeBody(spec, hashesByCard, { dryRun = false } = {}) {
  const child_attachments = spec.cards.map((card, index) => {
    const image_hash = hashesByCard[index + 1] || card.imageHash;
    if (!image_hash || (!dryRun && /^DRY_RUN_HASH_/.test(image_hash))) throw new Error(`Card ${index + 1} has no usable image hash`);
    const child = {
      link: card.link,
      image_hash,
      name: card.headline,
    };
    if (card.description) child.description = card.description;
    child.call_to_action = { type: card.callToAction || spec.callToAction, value: { link: card.link } };
    return child;
  });
  const body = {
    name: spec.name,
    object_story_spec: {
      page_id: spec.pageId,
      link_data: {
        message: spec.message,
        link: spec.link,
        call_to_action: { type: spec.callToAction, value: { link: spec.link } },
        child_attachments,
        multi_share_optimized: spec.optimizeOrder,
        multi_share_end_card: spec.endCard,
      },
    },
  };
  if (spec.instagramUserId) body.object_story_spec.instagram_user_id = String(spec.instagramUserId);
  return body;
}

function carouselExampleSpec() {
  return {
    name: "Spring offer carousel v1",
    pageId: "100000000000001",
    instagramUserId: "17800000000000001",
    message: "Primary text shown above the carousel.",
    link: "https://example.com/offer",
    callToAction: "LEARN_MORE",
    optimizeOrder: false,
    endCard: true,
    cards: [
      { image: "./slides/slide1.png", headline: "Slide 1 headline", description: "Optional description" },
      { image: "./slides/slide2.png", headline: "Slide 2 headline" },
      { imageHash: "IMAGE_HASH_PLACEHOLDER", headline: "Slide 3 headline" },
    ],
  };
}

module.exports = { MIN_CARDS, MAX_CARDS, MAX_UNOPTIMIZED_CARDS, MAX_IMAGE_BYTES, loadCarouselSpec, validateCarouselSpec, buildCarouselCreativeBody, carouselExampleSpec };
