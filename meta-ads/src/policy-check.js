"use strict";

/**
 * Policy check: reads ad text and flags anything likely to break Meta's
 * Advertising Standards. Offline, read-only and deterministic: the rules live
 * in policies/rules.json and the plain-words guide in
 * policies/meta-advertising-standards.md.
 *
 *   checkText(text)                 -> report for one string (primary text)
 *   checkCreative(input)            -> report for a creative, carousel spec,
 *                                      Content Studio handoff, cached ad or draft
 *   enforcePolicy({ action, input, override, dryRun })
 *                                   -> runs the check before a create path.
 *                                      BLOCK refuses unless an override reason
 *                                      is given; the override is audited.
 *
 * A report is { status: PASS|WARN|BLOCK, findings: [...], fieldsChecked, ... }.
 * Each finding: { level, ruleId, title, field, where, phrase, explain, rewrite,
 * source, category? }.
 */

const fs = require("fs");
const path = require("path");
const { writeAudit } = require("./audit-log");

const ROOT = path.join(__dirname, "..");
const RULES_PATH = path.join(ROOT, "policies/rules.json");
const STANDARDS_PATH = path.join(ROOT, "policies/meta-advertising-standards.md");
const DATA_DIR = path.join(ROOT, "data");
const STALE_AFTER_DAYS = 90;
const LEVEL_ORDER = { PASS: 0, WARN: 1, BLOCK: 2 };
const EXIT_CODES = { PASS: 0, WARN: 1, BLOCK: 2 };

// Which input keys hold which kind of ad text. Anything not listed (ids,
// image hashes, targeting, budgets, internal names) is never read as copy.
const FIELD_BY_KEY = {
  message: "primaryText", primaryText: "primaryText", primary_text: "primaryText", body: "primaryText",
  caption: "primaryText", text: "primaryText", offer: "primaryText", promise: "primaryText",
  headline: "headline", title: "headline",
  description: "description", link_description: "description",
  callToAction: "callToAction", call_to_action: "callToAction", callToActionType: "callToAction", call_to_action_type: "callToAction",
  link: "link", url: "link", website_url: "link", destinationUrl: "link", destination_url: "link",
  overlayText: "overlayText", overlay: "overlayText", overlay_text: "overlayText", textOverlay: "overlayText", text_overlay: "overlayText",
};
// Keys that never hold ad copy, so the walker skips them and everything under them.
const SKIP_KEYS = new Set([
  "targeting", "insights", "checklist", "campaign", "adSet", "adset", "image", "imageHash", "image_hash", "images",
  "pageId", "page_id", "instagramUserId", "instagram_user_id", "id", "status", "effective_status", "adset_id",
  "campaign_id", "creative_id", "creativeId", "adSetId", "thumbnail_url", "image_url", "url_tags", "placements",
  "policyCheck", "policyOverride", "audience", "angle", "warnings", "uploads", "summary",
]);
// Inside these containers the key "name" is shown to people (Meta's API uses
// link_data.name and child_attachments[].name for the headline).
const NAME_IS_HEADLINE_IN = new Set(["link_data", "child_attachments", "cards", "video_data", "template_data"]);
// Asset feed specs keep copy under { text } in typed arrays.
const TEXT_ARRAY_FIELD = { bodies: "primaryText", titles: "headline", descriptions: "description" };
// Slide arrays from a Content Studio handoff: every line on a slide is overlay text.
const SLIDE_ARRAYS = new Set(["slides", "overlays"]);
const SLIDE_TEXT_KEYS = new Set(["headline", "title", "text", "b_text", "promise", "keyword", "subtitle", "body", "caption", "lines", "items", "overlayText", "overlay"]);

let cachedRules = null;

function loadRules(rulesPath = RULES_PATH) {
  if (rulesPath === RULES_PATH && cachedRules) return cachedRules;
  const raw = JSON.parse(fs.readFileSync(rulesPath, "utf8"));
  const compile = (rule, list) => (list || []).map((pattern) => new RegExp(pattern, rule.flags === undefined ? "gi" : `g${rule.flags}`));
  const subject = new RegExp(raw.personalSubject, "i");
  const rules = (raw.rules || []).map((rule) => ({
    ...rule,
    regexes: compile(rule, rule.type === "personal-attribute" ? rule.attributes : rule.patterns),
  }));
  const special = (raw.specialCategories || []).map((rule) => ({ ...rule, type: "special-category", regexes: compile(rule, rule.patterns) }));
  const loaded = { version: raw.version, checkedOn: raw.checkedOn, subject, rules, special, all: [...rules, ...special] };
  if (rulesPath === RULES_PATH) cachedRules = loaded;
  return loaded;
}

function humanCta(value) {
  return String(value).replace(/_/g, " ").toLowerCase();
}

function pushText(out, field, where, value) {
  if (value === null || value === undefined) return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => pushText(out, field, `${where}[${index}]`, item));
    return;
  }
  if (typeof value === "object") {
    if (field === "callToAction" && typeof value.type === "string") pushText(out, field, `${where}.type`, value.type);
    if (field === "callToAction" && value.value && typeof value.value.link === "string") pushText(out, "link", `${where}.value.link`, value.value.link);
    if (typeof value.text === "string") pushText(out, field, `${where}.text`, value.text);
    return;
  }
  if (typeof value !== "string" && typeof value !== "number") return;
  const text = String(value).trim();
  if (!text) return;
  out.push({ field, where, text: field === "callToAction" && /^[A-Z_]+$/.test(text) ? humanCta(text) : text });
}

function walk(node, where, parentKey, out, depth = 0) {
  if (depth > 8 || node === null || node === undefined) return;
  if (Array.isArray(node)) {
    node.forEach((item, index) => {
      if (typeof item === "string") {
        if (SLIDE_ARRAYS.has(parentKey)) pushText(out, "overlayText", `${where}[${index}]`, item);
        return;
      }
      walk(item, `${where}[${index}]`, parentKey, out, depth + 1);
    });
    return;
  }
  if (typeof node !== "object") return;
  for (const [key, value] of Object.entries(node)) {
    const at = where ? `${where}.${key}` : key;
    if (SKIP_KEYS.has(key)) continue;
    if (SLIDE_ARRAYS.has(parentKey) && SLIDE_TEXT_KEYS.has(key) && typeof value !== "object") { pushText(out, "overlayText", at, value); continue; }
    if (SLIDE_ARRAYS.has(parentKey) && (key === "lines" || key === "items")) { pushText(out, "overlayText", at, value); continue; }
    if (TEXT_ARRAY_FIELD[key] && Array.isArray(value)) { pushText(out, TEXT_ARRAY_FIELD[key], at, value); continue; }
    if (key === "link_urls" && Array.isArray(value)) { value.forEach((item, index) => pushText(out, "link", `${at}[${index}]`, item && item.website_url)); continue; }
    if (key === "name") {
      if (NAME_IS_HEADLINE_IN.has(parentKey)) pushText(out, "headline", at, value);
      continue;
    }
    const field = FIELD_BY_KEY[key];
    if (field && (typeof value !== "object" || value === null || field === "callToAction" || field === "overlayText" || Array.isArray(value))) {
      pushText(out, field, at, value);
      continue;
    }
    if (value && typeof value === "object") walk(value, at, key, out, depth + 1);
  }
}

// Every piece of ad text in an input, labelled by field and where it was found.
function extractTexts(input) {
  const out = [];
  if (typeof input === "string") pushText(out, "primaryText", "text", input);
  else walk(input, "", "", out);
  const seen = new Set();
  return out.filter((item) => {
    const key = `${item.field}|${item.where}|${item.text}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sentences(text) {
  return String(text).split(/(?<=[.!?])\s+|\n+/).map((part) => part.trim()).filter(Boolean);
}

function matchRule(rule, item, subject) {
  const found = [];
  if (rule.skipFields && rule.skipFields.includes(item.field)) return found;
  if (rule.type === "link") {
    if (item.field !== "link") return found;
  } else if (item.field === "link") {
    return found;
  }
  if (rule.type === "personal-attribute") {
    for (const sentence of sentences(item.text)) {
      if (!subject.test(sentence)) continue;
      for (const regex of rule.regexes) {
        regex.lastIndex = 0;
        if (regex.test(sentence)) { found.push(sentence); break; }
      }
    }
    return found;
  }
  for (const regex of rule.regexes) {
    regex.lastIndex = 0;
    let match;
    while ((match = regex.exec(item.text)) !== null) {
      found.push(match[0]);
      if (match[0] === "") regex.lastIndex += 1;
    }
  }
  return found;
}

function worst(levels) {
  return levels.reduce((acc, level) => (LEVEL_ORDER[level] > LEVEL_ORDER[acc] ? level : acc), "PASS");
}

function checkTexts(texts, { rulesPath } = {}) {
  const rules = loadRules(rulesPath);
  const findings = [];
  const seen = new Set();
  for (const item of texts) {
    for (const rule of rules.all) {
      for (const phrase of matchRule(rule, item, rules.subject)) {
        const key = `${rule.id}|${item.where}|${phrase.toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        findings.push({
          level: rule.level,
          ruleId: rule.id,
          title: rule.title,
          field: item.field,
          where: item.where,
          phrase,
          explain: rule.explain,
          rewrite: rule.rewrite,
          source: rule.source,
          ...(rule.category ? { category: rule.category } : {}),
        });
      }
    }
  }
  findings.sort((a, b) => LEVEL_ORDER[b.level] - LEVEL_ORDER[a.level]);
  const status = worst(findings.map((finding) => finding.level));
  const specialCategories = [...new Set(findings.filter((finding) => finding.category).map((finding) => finding.category))];
  return {
    status,
    exitCode: EXIT_CODES[status],
    counts: { block: findings.filter((f) => f.level === "BLOCK").length, warn: findings.filter((f) => f.level === "WARN").length },
    findings,
    specialCategories,
    fieldsChecked: texts.map((item) => ({ field: item.field, where: item.where })),
    rulesVersion: rules.version,
    rulesCheckedOn: rules.checkedOn,
  };
}

function checkText(text, options) {
  return checkTexts(extractTexts(String(text)), options);
}

function checkCreative(input, options) {
  return checkTexts(extractTexts(input), options);
}

// ---------------------------------------------------------------------------
// Local cache lookups (never the network)
// ---------------------------------------------------------------------------

function readCacheRows(name, dataDir = DATA_DIR) {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(dataDir, `${name}.json`), "utf8"));
    return Array.isArray(parsed) ? parsed : Array.isArray(parsed?.data) ? parsed.data : [];
  } catch {
    return [];
  }
}

// Finds an ad or creative by id in data/ads.json or data/creatives.json.
// Returns { kind, ad, creative } or null.
function findCached(id, dataDir = DATA_DIR) {
  const wanted = String(id);
  for (const ad of readCacheRows("ads", dataDir)) {
    if (String(ad.id) === wanted) return { kind: "ad", ad, creative: ad.creative || null };
    if (ad.creative && String(ad.creative.id) === wanted) return { kind: "creative", ad, creative: ad.creative };
  }
  for (const creative of readCacheRows("creatives", dataDir)) {
    if (String(creative.id) === wanted) return { kind: "creative", ad: null, creative };
  }
  return null;
}

const CREATIVE_FIELDS = "id,name,title,body,object_story_spec,asset_feed_spec,call_to_action_type,link_url";
const AD_FIELDS = "id,name,effective_status,ad_review_feedback,creative{id,title,body,object_story_spec,asset_feed_spec,call_to_action_type,link_url}";

/**
 * Turns what the user typed into something to check:
 *   a JSON file path, inline JSON, a creative or ad id, or plain text.
 * Ids are looked up in the local cache first. Only an id missing from the
 * cache is read from Meta, with a read-only GET through the api client (which
 * redacts credentials). Returns { input, source, ad? }.
 */
async function resolvePolicyInput(target, { dataDir = DATA_DIR, apiClient, credentialsPresent } = {}) {
  const value = String(target || "").trim();
  if (!value) throw new Error("Usage: policy check <file.json|'<json>'|creative-id|\"ad text\">");
  if (value.startsWith("{") || value.startsWith("[")) return { input: JSON.parse(value), source: "inline JSON" };
  let isFile = false;
  try { isFile = value.length < 1024 && fs.statSync(value).isFile(); } catch { isFile = false; }
  if (isFile) {
    const raw = fs.readFileSync(value, "utf8");
    try { return { input: JSON.parse(raw), source: `file ${path.basename(value)}` }; } catch { return { input: raw, source: `text file ${path.basename(value)}` }; }
  }
  if (/^\d{5,}$/.test(value)) {
    const cached = findCached(value, dataDir);
    if (cached) return { input: cached.creative || cached.ad, source: `local cache (${cached.kind} ${value})`, ad: cached.ad };
    const hasCredentials = credentialsPresent !== undefined ? credentialsPresent : Boolean(process.env.META_ADS_ACCESS_TOKEN && process.env.META_ADS_ACCOUNT_ID);
    if (!hasCredentials) throw new Error(`${value} is not in the local cache and Meta credentials are not set. Run sync first, or paste the ad text instead.`);
    const client = apiClient || require("./api-client");
    try {
      const creative = await client.apiCall(`/${value}`, "GET", null, { fields: CREATIVE_FIELDS });
      if (creative && (creative.body || creative.title || creative.object_story_spec || creative.asset_feed_spec)) return { input: creative, source: `Meta API (creative ${value}, read only)` };
    } catch { /* not a creative id; try it as an ad */ }
    const ad = await client.apiCall(`/${value}`, "GET", null, { fields: AD_FIELDS });
    return { input: ad.creative || ad, source: `Meta API (ad ${value}, read only)`, ad };
  }
  return { input: value, source: "text" };
}

// Every cached ad with policy risk, for the dashboard card.
function cachedAdRisks(dataDir = DATA_DIR, ads = readCacheRows("ads", dataDir)) {
  const risky = [];
  for (const ad of ads) {
    if (!ad || !ad.creative) continue;
    const report = checkCreative(ad.creative);
    if (report.status !== "PASS") risky.push({ id: ad.id, name: ad.name || null, status: report.status, ruleIds: [...new Set(report.findings.map((f) => f.ruleId))] });
  }
  return risky;
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

function fieldLabel(finding) {
  const card = finding.where.match(/(?:cards|child_attachments|slides)\[(\d+)\]/);
  const names = { primaryText: "primary text", headline: "headline", description: "description", callToAction: "button", link: "link", overlayText: "image text" };
  return `${card ? `card ${Number(card[1]) + 1} ` : ""}${names[finding.field] || finding.field}`;
}

function formatReport(report, { title = "Meta policy check" } = {}) {
  const lines = [];
  const summary = report.status === "PASS"
    ? "PASS: nothing in this ad text breaks the rules the agent knows."
    : `${report.status}: ${report.counts.block} to fix before running, ${report.counts.warn} to check.`;
  lines.push(`${title}: ${summary}`);
  if (!report.fieldsChecked.length) lines.push("No ad text was found to check (headline, primary text, description, button, image text or link).");
  for (const finding of report.findings) {
    lines.push("");
    lines.push(`${finding.level.padEnd(5)}  ${finding.ruleId}  (${fieldLabel(finding)})`);
    lines.push(`       Phrase: "${finding.phrase}"`);
    lines.push(`       Why:    ${finding.explain}`);
    lines.push(`       Try:    ${finding.rewrite}`);
  }
  if (report.specialCategories.length) {
    lines.push("");
    lines.push(`Special ad category to declare: ${report.specialCategories.join(", ")}. Set it in the campaign's special_ad_categories.`);
  }
  if (report.status !== "PASS") lines.push("", "Rules: policies/rules.json. Guide: policies/meta-advertising-standards.md.");
  return lines.join("\n");
}

function listRules(options) {
  const rules = loadRules(options && options.rulesPath);
  return rules.all.map((rule) => ({ id: rule.id, level: rule.level, type: rule.type, section: rule.section, title: rule.title, ...(rule.category ? { category: rule.category } : {}) }));
}

// ---------------------------------------------------------------------------
// Create-path guard
// ---------------------------------------------------------------------------

/**
 * Runs before every path that creates ad copy. Prints the findings to stderr.
 * BLOCK throws unless `override` holds a reason; an override is written to the
 * audit log with the reason and the rule ids. WARN prints and continues. Dry
 * runs are checked the same way.
 */
function enforcePolicy({ action, input, report, override, dryRun = false, log = (line) => console.error(line) }) {
  const result = report || checkCreative(input);
  if (result.status === "PASS") {
    if (result.fieldsChecked.length) log(`Meta policy check (${action}): PASS`);
    return result;
  }
  log(formatReport(result, { title: `Meta policy check (${action})` }));
  if (result.status !== "BLOCK") return result;
  const ruleIds = [...new Set(result.findings.filter((f) => f.level === "BLOCK").map((f) => f.ruleId))];
  const reason = typeof override === "string" ? override.trim() : "";
  if (override !== undefined && override !== null && !reason) {
    throw Object.assign(new Error(`${action}: --policy-override needs a reason in quotes, for example --policy-override "Approved by Meta support on 3 Oct"`), { exitCode: 2 });
  }
  if (!reason) {
    throw Object.assign(new Error(`${action} refused: this ad text is likely to be rejected by Meta (${ruleIds.join(", ")}). Use the rewrites above, then try again. If you are sure it is fine, rerun with --policy-override "<your reason>"; the reason is saved in the audit log.`), { exitCode: 2, policyReport: result });
  }
  writeAudit(`POLICY OVERRIDE ${action}`, { action, reason, ruleIds, dryRun: Boolean(dryRun) }, { overridden: true, status: result.status, dryRun: Boolean(dryRun), findings: result.findings.map((f) => ({ level: f.level, ruleId: f.ruleId, phrase: f.phrase })) });
  log(`Policy override recorded in the audit log. Reason: ${reason}. Rules overridden: ${ruleIds.join(", ")}.`);
  return { ...result, overridden: true, overrideReason: reason };
}

// Pulls --policy-override "<reason>" out of an argv array (mutates it).
function takeOverrideArg(args) {
  const index = args.indexOf("--policy-override");
  if (index === -1) return undefined;
  const value = args[index + 1];
  const reason = value === undefined || value.startsWith("--") ? "" : value;
  args.splice(index, reason === "" && value !== "" ? 1 : 2);
  return reason;
}

// ---------------------------------------------------------------------------
// Freshness of the bundled policy guide (doctor)
// ---------------------------------------------------------------------------

function standardsFreshness({ standardsPath = STANDARDS_PATH, now = new Date() } = {}) {
  let text;
  try {
    text = fs.readFileSync(standardsPath, "utf8");
  } catch {
    return { ok: false, checkedOn: null, ageDays: null, message: "policies/meta-advertising-standards.md is missing, so the policy check has no guide to point to. Reinstall the agent." };
  }
  const match = text.match(/^checkedOn:\s*(\d{4}-\d{2}-\d{2})\s*$/m);
  if (!match) return { ok: false, checkedOn: null, ageDays: null, message: "policies/meta-advertising-standards.md has no checkedOn line, so its age is unknown. Re-check it against Meta's pages and add one." };
  const checked = new Date(`${match[1]}T00:00:00Z`);
  const ageDays = Math.floor((now.getTime() - checked.getTime()) / 86400000);
  const stale = !Number.isFinite(ageDays) || ageDays > STALE_AFTER_DAYS;
  return {
    ok: !stale,
    checkedOn: match[1],
    ageDays,
    message: stale
      ? `The Meta policy guide was last checked on ${match[1]} (${ageDays} days ago, more than ${STALE_AFTER_DAYS}). Meta changes its rules often: re-check policies/meta-advertising-standards.md and policies/rules.json against https://transparency.meta.com/policies/ad-standards/ and update the checkedOn date.`
      : `The Meta policy guide was checked on ${match[1]} (${ageDays} days ago).`,
  };
}

// ---------------------------------------------------------------------------
// Rejection reasons -> rules
// ---------------------------------------------------------------------------

// Meta's rejection wording varies; these keywords map it to our rule ids.
const REJECTION_MAP = [
  { pattern: /personal (attribute|health|characteristic)|implies? (knowledge|personal)|assert(s|ing)? or impl/i, ruleIds: ["personal-attributes-health", "personal-attributes-finances", "personal-attributes-age", "personal-attributes-religion", "personal-attributes-sexuality-gender", "personal-attributes-race-ethnicity", "personal-attributes-criminal-record"] },
  { pattern: /unrealistic|misleading claim|guarantee|exaggerat|false or misleading/i, ruleIds: ["guaranteed-results", "fast-results-claim", "unsubstantiated-claims"] },
  { pattern: /income|money[- ]making|get rich|business opportunit|multi[- ]level|mlm/i, ruleIds: ["income-claims"] },
  { pattern: /investment|financial (product|service)|returns/i, ruleIds: ["investment-returns", "prohibited-financial-products", "special-category-credit"] },
  { pattern: /deceptive|prohibited commercial practice|scam|bait/i, ruleIds: ["guaranteed-results", "income-claims", "false-urgency", "fake-ui-or-prize"] },
  { pattern: /health|wellness|body image|weight|before[- ]and[- ]after|cosmetic|self[- ]perception/i, ruleIds: ["negative-self-image", "before-after", "weight-loss-claims", "cure-claims", "restricted-supplements"] },
  { pattern: /sensational|clickbait|shocking|low[- ]quality|engagement bait|withhold/i, ruleIds: ["sensational-clickbait", "low-quality-formatting"] },
  { pattern: /profan/i, ruleIds: ["profanity"] },
  { pattern: /special ad categor|housing|employment|credit|social issue|election|politic/i, ruleIds: ["special-category-housing", "special-category-employment", "special-category-credit", "special-category-politics"] },
  { pattern: /alcohol/i, ruleIds: ["restricted-alcohol"] },
  { pattern: /dating/i, ruleIds: ["restricted-dating"] },
  { pattern: /gambl|casino|betting/i, ruleIds: ["restricted-gambling"] },
  { pattern: /crypto/i, ruleIds: ["restricted-crypto"] },
  { pattern: /drug|pharma|prescription|addiction/i, ruleIds: ["restricted-pharma"] },
  { pattern: /tobacco|vap|nicotine/i, ruleIds: ["prohibited-tobacco-vape"] },
  { pattern: /weapon|firearm|ammunition|explosive/i, ruleIds: ["prohibited-weapons"] },
  { pattern: /landing page|destination|non[- ]functional|broken link|website/i, ruleIds: ["landing-page-https", "landing-page-placeholder"] },
  { pattern: /crisis|tragedy|controversial event/i, ruleIds: ["crisis-exploitation"] },
  { pattern: /lead (form|ad)|personal information|sensitive information/i, ruleIds: ["lead-sensitive-data"] },
];

function mapRejectionReason(text) {
  const ids = [];
  for (const entry of REJECTION_MAP) if (entry.pattern.test(String(text || ""))) ids.push(...entry.ruleIds);
  const known = new Set(listRules().map((rule) => rule.id));
  return [...new Set(ids)].filter((id) => known.has(id));
}

// Pulls Meta's review feedback out of a cached ad, if the sync captured it.
function rejectionFromCachedAd(ad) {
  if (!ad) return null;
  const feedback = ad.ad_review_feedback || ad.creative?.ad_review_feedback || null;
  const parts = [];
  if (feedback && typeof feedback === "object") {
    for (const group of Object.values(feedback)) {
      if (group && typeof group === "object") for (const [key, value] of Object.entries(group)) parts.push(`${key}: ${value}`);
      else if (group) parts.push(String(group));
    }
  } else if (typeof feedback === "string") parts.push(feedback);
  return { effectiveStatus: ad.effective_status || null, feedback: parts.join(" | ") || null };
}

module.exports = {
  RULES_PATH,
  STANDARDS_PATH,
  STALE_AFTER_DAYS,
  EXIT_CODES,
  loadRules,
  extractTexts,
  checkText,
  checkCreative,
  checkTexts,
  findCached,
  resolvePolicyInput,
  cachedAdRisks,
  formatReport,
  listRules,
  enforcePolicy,
  takeOverrideArg,
  standardsFreshness,
  mapRejectionReason,
  rejectionFromCachedAd,
};
