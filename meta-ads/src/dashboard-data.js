"use strict";

/**
 * Read-only, redacted data layer for the Mission Control dashboard.
 *
 * Everything here reads the agent's own cache under data/ (written by `sync`
 * and `refresh`) and the optimization planner's output. Nothing in this file
 * calls Meta, writes to Meta or changes a budget: `refresh` only runs the
 * existing read-only sync in a child process. Every returned value goes
 * through redactValue so a cached paging URL or error message can never carry
 * a credential into the UI.
 *
 * Sections (each returns plain JSON, never throws on missing data):
 *   overview(options)      headline numbers for a period, with the previous period
 *   ads(options)           every campaign, ad set and ad with its numbers
 *   improvements(options)  the planner's proposals plus rule-based cards, owner language
 *   summary(options)       a weekly plain-language summary for a business owner
 *   freshness(options)     last sync, credentials present, whether a refresh can run
 *   refresh(options)       runs `node src/index.js refresh` and reports the outcome
 *
 * options.dataDir points at another cache folder (tests); options.period is one
 * of 7d, 14d, 30d, month.
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const config = require("../config/config.json");
const { redactValue, redactString } = require("./redact");
const { activeBudgetCap } = require("./recipe-helpers");
const policyCheck = require("./policy-check");

const ROOT = path.join(__dirname, "..");
// Test switches: META_ADS_DATA_DIR points the layer at another cache folder
// (fixtures, never the live cache); META_ADS_IGNORE_ENV_FILES=1 makes the
// presence check look at process.env only, so a verification run can show the
// setup state on a machine that has a real .env. Neither reads a credential.
const DEFAULT_DATA_DIR = process.env.META_ADS_DATA_DIR ? path.resolve(process.env.META_ADS_DATA_DIR) : path.join(ROOT, "data");
const ENV_FILES = process.env.META_ADS_IGNORE_ENV_FILES === "1" ? [] : [path.join(ROOT, ".env"), path.join(ROOT, "../../.env")];
const SECTIONS = ["overview", "ads", "improvements", "summary", "freshness"];
const PERIODS = {
  "7d": { days: 7, label: "Last 7 days" },
  "14d": { days: 14, label: "Last 14 days" },
  "30d": { days: 30, label: "Last 30 days" },
  month: { days: null, label: "This month" },
};
const DEFAULT_PERIOD = "7d";
const STALE_AFTER_HOURS = 24;
const DAY_MS = 86400000;

// What an owner calls a "result", in priority order. The first type with any
// count in the period is the primary result; the alias lists cover the names
// Meta uses for the same event so nothing is double counted.
const RESULT_TYPES = [
  { key: "purchase", label: "Purchases", singular: "purchase", actions: ["offsite_conversion.fb_pixel_purchase", "purchase", "omni_purchase", "onsite_web_purchase"] },
  { key: "lead", label: "Leads", singular: "lead", actions: ["offsite_conversion.fb_pixel_lead", "lead", "onsite_conversion.lead_grouped", "leadgen_grouped"] },
  { key: "registration", label: "Sign-ups", singular: "sign-up", actions: ["offsite_conversion.fb_pixel_complete_registration", "complete_registration"] },
  { key: "messages", label: "Conversations started", singular: "conversation", actions: ["onsite_conversion.messaging_conversation_started_7d", "onsite_conversion.messaging_first_reply"] },
  { key: "checkout", label: "Checkouts started", singular: "checkout", actions: ["offsite_conversion.fb_pixel_initiate_checkout", "initiate_checkout", "omni_initiated_checkout"] },
  { key: "landing_page_view", label: "Landing page views", singular: "landing page view", actions: ["landing_page_view", "omni_landing_page_view"] },
  { key: "link_click", label: "Link clicks", singular: "link click", actions: ["link_click"] },
  { key: "video_view", label: "Video views", singular: "video view", actions: ["video_view"] },
  { key: "post_engagement", label: "Post engagements", singular: "engagement", actions: ["post_engagement"] },
];
const PRIMARY_ORDER = ["purchase", "lead", "registration", "messages", "checkout", "landing_page_view", "link_click"];
const PURCHASE_VALUE_ACTIONS = RESULT_TYPES[0].actions;

// ---------------------------------------------------------------------------
// Cache access
// ---------------------------------------------------------------------------

function readJson(dir, name) {
  const file = path.join(dir, `${name}.json`);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function rows(value) {
  if (Array.isArray(value)) return value;
  if (value && Array.isArray(value.data)) return value.data;
  return [];
}

function loadCache(dataDir) {
  const account = readJson(dataDir, "account");
  const dashboard = readJson(dataDir, "dashboard");
  const cache = {
    dataDir,
    account: account && typeof account === "object" ? account : dashboard?.account || null,
    campaigns: rows(readJson(dataDir, "campaigns")).length ? rows(readJson(dataDir, "campaigns")) : rows(dashboard?.campaigns),
    adsets: rows(readJson(dataDir, "adsets")),
    ads: rows(readJson(dataDir, "ads")),
    insights: rows(readJson(dataDir, "insights")).length ? rows(readJson(dataDir, "insights")) : rows(dashboard?.insights),
    daily: rows(readJson(dataDir, "insights-daily")).filter((row) => row && typeof row.date_start === "string"),
    byCampaign: rows(readJson(dataDir, "insights-campaigns")),
    byAdset: rows(readJson(dataDir, "insights-adsets")),
    byAd: rows(readJson(dataDir, "insights-ads")),
    lastSync: readJson(dataDir, "last-sync"),
  };
  cache.daily.sort((a, b) => (a.date_start < b.date_start ? -1 : a.date_start > b.date_start ? 1 : 0));
  cache.currency = cache.account?.currency || config.defaultCurrency || "USD";
  cache.hasData = Boolean(cache.account || cache.campaigns.length || cache.insights.length || cache.daily.length);
  cache.optimization = loadOptimization(dataDir, cache.account?.id);
  return cache;
}

function loadOptimization(dataDir, accountId) {
  const base = path.join(dataDir, "optimization");
  if (!fs.existsSync(base)) return { report: null, queue: [] };
  const folders = accountId && fs.existsSync(path.join(base, accountId))
    ? [accountId]
    : fs.readdirSync(base, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  for (const folder of folders) {
    const report = readJson(path.join(base, folder), "latest-report");
    const queue = rows(readJson(path.join(base, folder), "proposal-queue"));
    if (report || queue.length) return { report, queue };
  }
  return { report: null, queue: [] };
}

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

function num(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function actionCount(list, types) {
  if (!Array.isArray(list)) return null;
  for (const type of types) {
    const row = list.find((item) => item && item.action_type === type);
    if (row) return num(row.value);
  }
  return null;
}

function divide(a, b) {
  return a !== null && b !== null && b > 0 ? a / b : null;
}

function round(value, digits = 2) {
  return value === null || value === undefined ? null : Number(value.toFixed(digits));
}

function changePct(current, previous) {
  if (current === null || previous === null || previous === 0) return null;
  return round(((current - previous) / previous) * 100, 1);
}

/**
 * Collapses one or many insight rows into one set of owner-facing metrics.
 * primaryKey pins the result type (the account's own, see primaryResultType)
 * so every campaign, ad set and ad counts the same thing; without it the first
 * type in priority order with any count wins.
 */
function metricsFromRows(list, primaryKey = null) {
  const items = list.filter(Boolean);
  if (!items.length) return null;
  const sum = (key) => items.reduce((total, row) => total + (num(row[key]) ?? 0), 0);
  const spend = sum("spend");
  const impressions = sum("impressions");
  const clicks = sum("clicks");
  const reach = items.length === 1 ? num(items[0].reach) : (items.some((row) => num(row.reach) !== null) ? sum("reach") : null);
  const resultsByType = [];
  for (const type of RESULT_TYPES) {
    let count = null;
    for (const row of items) {
      const value = actionCount(row.actions, type.actions);
      if (value !== null) count = (count ?? 0) + value;
    }
    if (count !== null && count > 0) resultsByType.push({ key: type.key, label: type.label, singular: type.singular, count, costPer: round(divide(spend, count)) });
  }
  const pinned = primaryKey ? RESULT_TYPES.find((type) => type.key === primaryKey) : null;
  const primary = pinned
    ? (resultsByType.find((row) => row.key === primaryKey) || { key: pinned.key, label: pinned.label, singular: pinned.singular, count: 0, costPer: null })
    : PRIMARY_ORDER.map((key) => resultsByType.find((row) => row.key === key)).find(Boolean) || resultsByType[0] || null;
  let purchaseValue = null;
  for (const row of items) {
    const value = actionCount(row.action_values, PURCHASE_VALUE_ACTIONS);
    if (value !== null) purchaseValue = (purchaseValue ?? 0) + value;
  }
  let roas = divide(purchaseValue, spend);
  if (roas === null && items.length === 1 && Array.isArray(items[0].purchase_roas) && items[0].purchase_roas[0]) roas = num(items[0].purchase_roas[0].value);
  return {
    spend: round(spend),
    impressions,
    reach,
    clicks,
    ctr: round(divide(clicks, impressions) === null ? null : divide(clicks, impressions) * 100),
    cpc: round(divide(spend, clicks)),
    cpm: round(divide(spend, impressions) === null ? null : divide(spend, impressions) * 1000),
    frequency: round(divide(impressions, reach)),
    results: primary ? primary.count : 0,
    resultType: primary ? primary.key : null,
    resultLabel: primary ? primary.label : "Results",
    resultSingular: primary ? primary.singular : "result",
    costPerResult: primary ? primary.costPer : null,
    purchaseValue: round(purchaseValue),
    roas: round(roas),
    resultsByType,
    reachNote: items.length > 1 && reach !== null ? "Reach is added up day by day, so a person seen on two days counts twice." : null,
  };
}

/** The result type the whole account is judged by: taken from the account-level rows. */
function primaryResultType(cache) {
  const account = metricsFromRows(cache.daily.length ? cache.daily : cache.insights);
  if (account?.resultType) return account.resultType;
  const levels = metricsFromRows(cache.byCampaign);
  return levels?.resultType || null;
}

// ---------------------------------------------------------------------------
// Periods
// ---------------------------------------------------------------------------

function isoDay(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

function dayMs(iso) {
  return Date.parse(`${iso}T00:00:00Z`);
}

function resolvePeriod(cache, key) {
  const period = PERIODS[key] ? key : DEFAULT_PERIOD;
  const spec = PERIODS[period];
  if (!cache.daily.length) {
    const row = cache.insights[0] || null;
    return {
      key: period,
      requested: key || DEFAULT_PERIOD,
      label: row ? "Last 30 days (cached total)" : spec.label,
      since: row?.date_start || null,
      until: row?.date_stop || null,
      days: row?.date_start && row?.date_stop ? Math.round((dayMs(row.date_stop) - dayMs(row.date_start)) / DAY_MS) + 1 : null,
      source: row ? "cached_total" : "none",
      comparison: null,
      note: row ? "Day-by-day numbers arrive with the next refresh; until then the period picker shows the cached 30-day total and no comparison." : null,
      current: row ? [row] : [],
      previous: [],
      trend: [],
    };
  }
  const latest = cache.daily[cache.daily.length - 1].date_start;
  const latestMs = dayMs(latest);
  let sinceMs;
  let days;
  if (period === "month") {
    sinceMs = dayMs(`${latest.slice(0, 7)}-01`);
    days = Math.round((latestMs - sinceMs) / DAY_MS) + 1;
  } else {
    days = spec.days;
    sinceMs = latestMs - (days - 1) * DAY_MS;
  }
  const since = isoDay(sinceMs);
  const previousUntil = isoDay(sinceMs - DAY_MS);
  const previousSince = isoDay(sinceMs - days * DAY_MS);
  const inRange = (row, from, to) => row.date_start >= from && row.date_start <= to;
  const current = cache.daily.filter((row) => inRange(row, since, latest));
  const previous = cache.daily.filter((row) => inRange(row, previousSince, previousUntil));
  return {
    key: period,
    requested: key || DEFAULT_PERIOD,
    label: spec.label,
    since,
    until: latest,
    days,
    source: "daily",
    comparison: previous.length ? { since: previousSince, until: previousUntil, days } : null,
    note: previous.length ? null : "Not enough history yet for a comparison with the period before.",
    current,
    previous,
    trend: current.map((row) => {
      const m = metricsFromRows([row]);
      return { date: row.date_start, spend: m.spend, results: m.results, clicks: m.clicks, impressions: m.impressions };
    }),
  };
}

// ---------------------------------------------------------------------------
// Account, status and budgets
// ---------------------------------------------------------------------------

const ACCOUNT_STATUS = { 1: "Active", 2: "Disabled", 3: "Unsettled", 7: "Pending review", 8: "Pending settlement", 9: "In grace period", 100: "Pending closure", 101: "Closed", 201: "Any active", 202: "Any closed" };

function accountSummary(cache) {
  const account = cache.account;
  if (!account) return { name: null, currency: cache.currency, timezone: null, status: null, spendCapCents: null, balanceCents: null };
  return {
    name: account.name ? String(account.name) : null,
    currency: cache.currency,
    timezone: account.timezone_name || null,
    status: ACCOUNT_STATUS[account.account_status] || (account.account_status ? String(account.account_status) : null),
    spendCapCents: num(account.spend_cap) || null,
    balanceCents: num(account.balance),
  };
}

function statusLabel(row) {
  const effective = row.effective_status || row.status || null;
  if (!effective) return "Unknown";
  const map = {
    ACTIVE: "Active",
    PAUSED: "Paused",
    CAMPAIGN_PAUSED: "Paused (campaign)",
    ADSET_PAUSED: "Paused (ad set)",
    ARCHIVED: "Archived",
    DELETED: "Deleted",
    IN_PROCESS: "Processing",
    WITH_ISSUES: "Has issues",
    PENDING_REVIEW: "In review",
    DISAPPROVED: "Disapproved",
    PREAPPROVED: "Pre-approved",
    PENDING_BILLING_INFO: "Needs billing info",
  };
  return map[effective] || effective.charAt(0) + effective.slice(1).toLowerCase().replace(/_/g, " ");
}

function isActive(row) {
  return (row.effective_status || row.status) === "ACTIVE";
}

function budgetOf(row) {
  const daily = num(row.daily_budget);
  const lifetime = num(row.lifetime_budget);
  if (daily) return { type: "daily", cents: daily };
  if (lifetime) return { type: "lifetime", cents: lifetime };
  return { type: null, cents: null };
}

function lastChangeOf(row) {
  return row.updated_time || row.start_time || row.created_time || null;
}

function envPresence(environment = process.env) {
  // Presence only: which required names are set in the process or in the
  // agent's .env files. Values never leave this function.
  const names = config.requiredEnvVars || [];
  const fileKeys = new Set();
  for (const file of ENV_FILES) {
    if (!fs.existsSync(file)) continue;
    let text;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const line of text.split(/\r?\n/)) {
      const match = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(\S.*)?$/.exec(line);
      if (match && match[2]) fileKeys.add(match[1]);
    }
  }
  const present = (name) => Boolean(environment[name]) || fileKeys.has(name);
  const missing = names.filter((name) => !present(name));
  const writesEnabled = environment.META_ADS_WRITES_ENABLED === "true" || (!environment.META_ADS_WRITES_ENABLED && fileKeys.has("META_ADS_WRITES_ENABLED") && readEnvValue("META_ADS_WRITES_ENABLED") === "true");
  const capValue = environment.META_ADS_MAX_DAILY_BUDGET_CENTS !== undefined ? environment.META_ADS_MAX_DAILY_BUDGET_CENTS : readEnvValue("META_ADS_MAX_DAILY_BUDGET_CENTS");
  const cap = activeBudgetCap(capValue === undefined ? {} : { META_ADS_MAX_DAILY_BUDGET_CENTS: capValue });
  return { required: names, missing, configured: missing.length === 0, writesEnabled, budgetCap: cap };
}

// Reads one non-secret setting (writes flag, budget cap) from the agent's .env.
// Only names listed in config.optionalEnvVars are ever read this way.
function readEnvValue(name) {
  if (!(config.optionalEnvVars || []).includes(name)) return undefined;
  for (const file of ENV_FILES) {
    if (!fs.existsSync(file)) continue;
    let text;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const line of text.split(/\r?\n/)) {
      const match = new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=\\s*(.*)$`).exec(line);
      if (match) return match[1].trim().replace(/^['"]|['"]$/g, "");
    }
  }
  return undefined;
}

function hoursSince(iso) {
  const ms = Date.parse(iso || "");
  return Number.isFinite(ms) ? round((Date.now() - ms) / 3600000, 1) : null;
}

function emptyState(section, cache) {
  const env = envPresence();
  return {
    ok: true,
    empty: true,
    section,
    message: env.configured
      ? "No synced data yet. Press Refresh (or run: node src/index.js refresh) to pull your campaigns and numbers from Meta."
      : "Meta credentials are not set up yet, so there is nothing to show. Add META_ADS_ACCESS_TOKEN, META_ADS_ACCOUNT_ID, META_ADS_APP_ID and META_ADS_APP_SECRET to agents/meta-ads/.env, run doctor, then Refresh.",
    credentialsConfigured: env.configured,
    missing: env.missing,
    account: accountSummary(cache),
    lastSync: cache.lastSync?.timestamp || null,
  };
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

function metric(key, label, current, previous, format, extra = {}) {
  const value = current ? current[key] : null;
  const prior = previous ? previous[key] : null;
  const lowerIsBetter = ["costPerResult", "cpc", "cpm", "frequency"].includes(key);
  const change = changePct(value ?? null, prior ?? null);
  return {
    key,
    label,
    value: value ?? null,
    previous: prior ?? null,
    changePct: change,
    direction: change === null ? null : change === 0 ? "flat" : (change > 0) === !lowerIsBetter ? "better" : "worse",
    format,
    ...extra,
  };
}

async function overview(options = {}) {
  const cache = loadCache(options.dataDir || DEFAULT_DATA_DIR);
  if (!cache.hasData || (!cache.insights.length && !cache.daily.length)) return redactValue(emptyState("overview", cache));
  const period = resolvePeriod(cache, options.period);
  const primary = primaryResultType(cache);
  const current = metricsFromRows(period.current, primary);
  const previous = period.previous.length ? metricsFromRows(period.previous, primary) : null;
  const resultLabel = current?.resultLabel || "Results";
  const metrics = [
    metric("spend", "Spent", current, previous, "currency"),
    metric("results", resultLabel, current, previous, "integer", { resultType: current?.resultType || null }),
    metric("costPerResult", `Cost per ${current?.resultSingular || "result"}`, current, previous, "currency"),
    metric("impressions", "Times shown", current, previous, "integer"),
    metric("reach", "People reached", current, previous, "integer", { note: current?.reachNote || null }),
    metric("clicks", "Clicks", current, previous, "integer"),
    metric("ctr", "Click rate (CTR)", current, previous, "percent"),
    metric("cpm", "Cost per 1,000 views (CPM)", current, previous, "currency"),
    metric("cpc", "Cost per click", current, previous, "currency"),
    metric("frequency", "Times each person saw it", current, previous, "decimal"),
  ];
  if (current?.purchaseValue !== null && current?.purchaseValue !== undefined) {
    metrics.push(metric("purchaseValue", "Sales value", current, previous, "currency"));
    metrics.push(metric("roas", "Return on ad spend (ROAS)", current, previous, "multiple"));
  }
  const resultsByType = (current?.resultsByType || []).map((row) => {
    const prior = previous?.resultsByType.find((item) => item.key === row.key) || null;
    return { ...row, previous: prior ? prior.count : null, changePct: changePct(row.count, prior ? prior.count : null) };
  });
  return redactValue({
    ok: true,
    empty: false,
    account: accountSummary(cache),
    period: { key: period.key, label: period.label, since: period.since, until: period.until, days: period.days, source: period.source, comparison: period.comparison, note: period.note },
    metrics,
    resultsByType,
    trend: period.trend,
    campaigns: { total: cache.campaigns.length, active: cache.campaigns.filter(isActive).length, paused: cache.campaigns.filter((row) => !isActive(row)).length },
    lastSync: cache.lastSync?.timestamp || null,
  });
}

function joinLevel(cache, level) {
  const inventory = level === "campaign" ? cache.campaigns : level === "adset" ? cache.adsets : cache.ads;
  const insights = level === "campaign" ? cache.byCampaign : level === "adset" ? cache.byAdset : cache.byAd;
  const idKey = `${level}_id`;
  const byId = new Map();
  for (const row of insights) if (row && row[idKey]) byId.set(String(row[idKey]), row);
  const campaignName = new Map(cache.campaigns.map((row) => [String(row.id), row.name]));
  const adsetName = new Map(cache.adsets.map((row) => [String(row.id), row.name]));
  const adsetCampaign = new Map(cache.adsets.map((row) => [String(row.id), String(row.campaign_id || "")]));
  const primary = primaryResultType(cache);
  const out = [];
  for (const item of inventory) {
    if (!item || !item.id) continue;
    const id = String(item.id);
    const m = metricsFromRows([byId.get(id)], primary);
    const campaignId = level === "campaign" ? id : String(item.campaign_id || adsetCampaign.get(String(item.adset_id || "")) || "");
    const budget = budgetOf(item);
    out.push({
      level,
      id,
      name: item.name || `(unnamed ${level})`,
      status: statusLabel(item),
      rawStatus: item.effective_status || item.status || null,
      active: isActive(item),
      objective: item.objective || null,
      optimizationGoal: item.optimization_goal || null,
      campaignId: campaignId || null,
      campaignName: campaignName.get(campaignId) || (level === "campaign" ? item.name : null),
      adsetId: level === "ad" ? String(item.adset_id || "") || null : level === "adset" ? id : null,
      adsetName: level === "ad" ? adsetName.get(String(item.adset_id || "")) || null : level === "adset" ? item.name : null,
      budget,
      spend: m?.spend ?? 0,
      impressions: m?.impressions ?? 0,
      clicks: m?.clicks ?? 0,
      ctr: m?.ctr ?? null,
      cpm: m?.cpm ?? null,
      frequency: m?.frequency ?? null,
      results: m?.results ?? 0,
      resultType: m?.resultType ?? null,
      resultLabel: m?.resultLabel ?? "Results",
      costPerResult: m?.costPerResult ?? null,
      resultsByType: m?.resultsByType ?? [],
      purchaseValue: m?.purchaseValue ?? null,
      roas: m?.roas ?? null,
      lastChange: lastChangeOf(item),
      hasInsights: Boolean(byId.get(id)),
    });
  }
  return out;
}

async function ads(options = {}) {
  const cache = loadCache(options.dataDir || DEFAULT_DATA_DIR);
  if (!cache.hasData || !cache.campaigns.length) return redactValue(emptyState("ads", cache));
  const campaigns = joinLevel(cache, "campaign");
  const adsets = joinLevel(cache, "adset");
  const adRows = joinLevel(cache, "ad");
  const window = cache.byCampaign[0] || cache.byAdset[0] || cache.byAd[0] || null;
  return redactValue({
    ok: true,
    empty: false,
    account: accountSummary(cache),
    currency: cache.currency,
    window: window ? { since: window.date_start || null, until: window.date_stop || null, label: "Last 30 days at the last refresh" } : { since: null, until: null, label: "Numbers arrive with the next refresh" },
    counts: { campaigns: campaigns.length, adsets: adsets.length, ads: adRows.length, activeCampaigns: campaigns.filter((row) => row.active).length },
    rows: [...campaigns, ...adsets, ...adRows],
    lastSync: cache.lastSync?.timestamp || null,
  });
}

// ---------------------------------------------------------------------------
// Improvements
// ---------------------------------------------------------------------------

const GROUPS = {
  scale: { label: "Scale", blurb: "Working well. Give it more room, one step at a time." },
  fix: { label: "Fix", blurb: "Spending, but something in the ad or audience is holding it back." },
  stop: { label: "Stop", blurb: "Spending without results. Pause it before it costs more." },
  watch: { label: "Watch", blurb: "Too early or too uncertain to act. Check again after the next refresh." },
};

function fmtMoney(value, currency) {
  if (value === null || value === undefined) return "n/a";
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}

function cents(value) {
  return Math.round(value);
}

function card({ id, group, title, what, why, evidence, expectedEffect, risk, riskNote, nextStep, command, recipe, source, objectId, level, objectName }) {
  return { id, group, groupLabel: GROUPS[group].label, title, what, why, evidence, expectedEffect, risk, riskNote, nextStep, command: command || null, recipe: recipe || null, source, objectId: objectId || null, level: level || null, objectName: objectName || null, appliesWrite: false };
}

function ruleCards(cache, rowsByLevel, env) {
  const currency = cache.currency;
  const cap = env.budgetCap.limitCents;
  const cards = [];
  const all = [...rowsByLevel.adset, ...rowsByLevel.campaign];
  const spent = all.filter((row) => row.spend > 0);
  const accountSpend = rowsByLevel.campaign.reduce((total, row) => total + row.spend, 0);
  const accountResults = rowsByLevel.campaign.reduce((total, row) => total + row.results, 0);
  const accountCpr = accountResults > 0 ? accountSpend / accountResults : null;
  const accountCtr = (() => {
    const impressions = rowsByLevel.campaign.reduce((total, row) => total + row.impressions, 0);
    const clicks = rowsByLevel.campaign.reduce((total, row) => total + row.clicks, 0);
    return impressions > 0 ? (clicks / impressions) * 100 : null;
  })();
  const budgetCommand = (row, newCents) => `node src/index.js ${row.level === "campaign" ? "campaigns" : "adsets"} budget ${row.id} ${newCents} --dry-run`;
  const pauseCommand = (row) => (row.level === "campaign" ? `node src/index.js campaigns pause ${row.id} --dry-run` : null);

  for (const row of spent.filter((item) => item.active)) {
    const label = `${row.level === "campaign" ? "Campaign" : "Ad set"} "${row.name}"`;
    const money = fmtMoney(row.spend, currency);
    // Stop: real spend, no results, and the account knows what a result costs.
    const stopFloor = accountCpr !== null ? accountCpr * 2 : accountSpend * 0.25;
    if (row.results === 0 && row.spend >= Math.max(stopFloor, 10)) {
      const lower = row.budget.type === "daily" && row.budget.cents ? Math.max(100, cents(row.budget.cents / 2)) : null;
      cards.push(card({
        id: `stop-${row.level}-${row.id}`,
        group: "stop",
        title: `${label} spent ${money} with no ${row.resultLabel.toLowerCase() === "results" ? "results" : row.resultLabel.toLowerCase()}`,
        what: row.level === "campaign" ? "Pause this campaign." : "Pause this ad set, or halve its budget while you decide.",
        why: accountCpr !== null
          ? `It spent ${money} in the last 30 days without a single result, while the rest of the account pays about ${fmtMoney(accountCpr, currency)} per result.`
          : `It spent ${money} in the last 30 days without a single result, which is a quarter or more of everything you spent.`,
        evidence: [
          { label: "Spent (30 days)", value: row.spend, format: "currency" },
          { label: "Results", value: 0, format: "integer" },
          { label: "Clicks", value: row.clicks, format: "integer" },
          ...(accountCpr !== null ? [{ label: "Account cost per result", value: round(accountCpr), format: "currency" }] : []),
        ],
        expectedEffect: `Saves about ${fmtMoney(row.budget.type === "daily" && row.budget.cents ? row.budget.cents / 100 : row.spend / 30, currency)} a day with no results lost.`,
        risk: "low",
        riskNote: "Pausing is reversible: activate it again any time.",
        nextStep: row.level === "campaign"
          ? "Preview the pause with the dry run below, then run it without --dry-run and type the confirmation phrase it asks for."
          : "Preview the lower budget with the dry run below, or pause the ad set in Ads Manager.",
        command: pauseCommand(row) || (lower ? budgetCommand(row, lower) : null),
        recipe: row.level === "campaign" ? "recipes/pause-campaign" : "recipes/update-budget",
        source: "rules",
        objectId: row.id,
        level: row.level,
        objectName: row.name,
      }));
      continue;
    }
    // Scale: enough results and a clearly better cost per result than the account.
    if (row.results >= 3 && accountCpr !== null && row.costPerResult !== null && row.costPerResult <= accountCpr * 0.7) {
      const currentDaily = row.budget.type === "daily" ? row.budget.cents : null;
      const proposed = currentDaily ? Math.min(cents(currentDaily * 1.2), cap || Infinity) : null;
      const blockedByCap = currentDaily !== null && cap !== null && currentDaily >= cap;
      cards.push(card({
        id: `scale-${row.level}-${row.id}`,
        group: "scale",
        title: `${label} gets ${row.resultLabel.toLowerCase()} for ${fmtMoney(row.costPerResult, currency)} each`,
        what: blockedByCap
          ? `Raise its daily budget once the budget cap (${fmtMoney(cap / 100, currency)} a day) is lifted.`
          : currentDaily
            ? `Raise its daily budget by 20%, from ${fmtMoney(currentDaily / 100, currency)} to ${fmtMoney(proposed / 100, currency)}.`
            : "Give this one more budget; it uses a lifetime or campaign-level budget, so adjust that.",
        why: `${row.results} ${row.resultLabel.toLowerCase()} at ${fmtMoney(row.costPerResult, currency)} each, against ${fmtMoney(accountCpr, currency)} across the account. Small steps keep Meta's learning stable.`,
        evidence: [
          { label: "Results (30 days)", value: row.results, format: "integer" },
          { label: "Cost per result", value: row.costPerResult, format: "currency" },
          { label: "Account cost per result", value: round(accountCpr), format: "currency" },
          { label: "Spent", value: row.spend, format: "currency" },
          ...(currentDaily ? [{ label: "Daily budget", value: currentDaily / 100, format: "currency" }] : []),
        ],
        expectedEffect: `About ${Math.round(row.results * 0.2)} more ${row.resultLabel.toLowerCase()} a month if the cost per result holds.`,
        risk: "medium",
        riskNote: "Cost per result often rises a little when budgets rise. Change one thing at a time and check again in a week.",
        nextStep: blockedByCap
          ? `The agent caps every budget write at ${fmtMoney(cap / 100, currency)} a day (META_ADS_MAX_DAILY_BUDGET_CENTS). Raise the cap yourself first if you want this.`
          : "Preview the change with the dry run below, then run it without --dry-run and type the confirmation phrase it asks for.",
        command: currentDaily && !blockedByCap ? budgetCommand(row, proposed) : null,
        recipe: "recipes/update-budget",
        source: "rules",
        objectId: row.id,
        level: row.level,
        objectName: row.name,
      }));
      continue;
    }
    // Fix: people see it but do not click, or see it too often.
    if (row.impressions >= 1000 && row.ctr !== null && accountCtr !== null && row.ctr < Math.min(0.8, accountCtr * 0.6)) {
      cards.push(card({
        id: `fix-ctr-${row.level}-${row.id}`,
        group: "fix",
        title: `${label} is shown a lot but rarely clicked`,
        what: "Refresh the creative: a new first line, a new image or a clearer offer.",
        why: `${row.impressions.toLocaleString("en-US")} views and a click rate of ${row.ctr.toFixed(2)}%, against ${accountCtr.toFixed(2)}% across the account. The audience sees it; the ad is not earning the click.`,
        evidence: [
          { label: "Times shown", value: row.impressions, format: "integer" },
          { label: "Click rate", value: row.ctr, format: "percent" },
          { label: "Account click rate", value: round(accountCtr), format: "percent" },
          { label: "Spent", value: row.spend, format: "currency" },
        ],
        expectedEffect: "Lifting the click rate to the account average would roughly double the clicks for the same spend.",
        risk: "low",
        riskNote: "Add the new ad paused, next to the old one, and let the numbers pick the winner.",
        nextStep: "Draft a new creative offline first (the carousel template below is a safe start), then create it paused.",
        command: "node src/index.js creatives carousel --example",
        recipe: "recipes/create-carousel-creative",
        source: "rules",
        objectId: row.id,
        level: row.level,
        objectName: row.name,
      }));
      continue;
    }
    if (row.frequency !== null && row.frequency >= 3 && row.impressions >= 1000) {
      cards.push(card({
        id: `fix-frequency-${row.level}-${row.id}`,
        group: "fix",
        title: `${label} shows the same people the same ad ${row.frequency.toFixed(1)} times`,
        what: "Widen the audience or rotate in a new creative.",
        why: `Each person has seen it ${row.frequency.toFixed(1)} times in 30 days. Above about 3, people start to tune out and the cost per result climbs.`,
        evidence: [
          { label: "Frequency", value: row.frequency, format: "decimal" },
          { label: "People reached", value: row.impressions && row.frequency ? Math.round(row.impressions / row.frequency) : null, format: "integer" },
          { label: "Spent", value: row.spend, format: "currency" },
        ],
        expectedEffect: "Fresh people or a fresh ad usually brings the cost per result back down within a week.",
        risk: "low",
        riskNote: "Broadening an audience is reversible; do it on a copy of the ad set if you want to compare.",
        nextStep: "Search for a broader interest to add, then draft the new ad set offline.",
        command: "node src/index.js targeting search \"<your interest>\"",
        recipe: "recipes/search-targeting",
        source: "rules",
        objectId: row.id,
        level: row.level,
        objectName: row.name,
      }));
      continue;
    }
    // Watch: spending, but too little data to call it.
    if (row.impressions < 1000 || (row.results > 0 && row.results < 3)) {
      cards.push(card({
        id: `watch-${row.level}-${row.id}`,
        group: "watch",
        title: `${label} is still too new to judge`,
        what: "Leave it running and look again after the next refresh.",
        why: row.impressions < 1000
          ? `Only ${row.impressions.toLocaleString("en-US")} views so far; Meta needs about 1,000 before the numbers mean anything.`
          : `${row.results} ${row.resultLabel.toLowerCase()} is too few to tell luck from a trend.`,
        evidence: [
          { label: "Times shown", value: row.impressions, format: "integer" },
          { label: "Results", value: row.results, format: "integer" },
          { label: "Spent", value: row.spend, format: "currency" },
        ],
        expectedEffect: "A clear read in about a week.",
        risk: "low",
        riskNote: "Changing it now would restart Meta's learning phase.",
        nextStep: "Nothing to run. Refresh in a few days.",
        command: null,
        source: "rules",
        objectId: row.id,
        level: row.level,
        objectName: row.name,
      }));
    }
  }
  return cards;
}

function plannerCards(cache) {
  const report = cache.optimization.report;
  const proposals = report?.proposals?.length ? report.proposals : cache.optimization.queue.slice(-3);
  const currency = cache.currency;
  const cards = [];
  for (const proposal of proposals) {
    if (!proposal || !proposal.id) continue;
    const metrics = proposal.evidence?.campaigns?.[0]?.metrics || proposal.evidence?.candidate?.metrics || report?.accountMetrics || {};
    const evidence = [
      ...(metrics.spend !== null && metrics.spend !== undefined ? [{ label: "Spent (7 days)", value: round(metrics.spend), format: "currency" }] : []),
      ...(metrics.purchases !== null && metrics.purchases !== undefined ? [{ label: "Purchases", value: metrics.purchases, format: "integer" }] : []),
      ...(metrics.cpa !== null && metrics.cpa !== undefined ? [{ label: "Cost per purchase", value: round(metrics.cpa), format: "currency" }] : []),
      ...(metrics.roas !== null && metrics.roas !== undefined ? [{ label: "Return on ad spend", value: round(metrics.roas), format: "multiple" }] : []),
      ...(proposal.evidence?.periods?.recent ? [{ label: "Period", value: `${proposal.evidence.periods.recent.since} to ${proposal.evidence.periods.recent.until}`, format: "text" }] : []),
    ];
    if (proposal.id === "measurement-reconciliation") {
      cards.push(card({
        id: `planner-${proposal.id}`,
        group: "watch",
        title: "Check that your sales tracking matches real orders",
        what: "Compare the purchases Meta reports with the orders in your payment system for the same days.",
        why: `Meta reports ${metrics.purchases ?? "an unknown number of"} purchases for ${fmtMoney(metrics.spend ?? null, currency)} of spend. Until that matches your own receipts, every scale or stop decision rests on numbers that might be off. ${proposal.counterevidence || ""}`.trim(),
        evidence,
        expectedEffect: "Confidence that the cost per result on this page is real before money moves.",
        risk: "low",
        riskNote: "Reading only. Nothing changes in the ad account.",
        nextStep: "Pull the receipts for the same dates, compare the count, then re-run the optimizer.",
        command: "node bin/optimize.js --dry-run",
        recipe: "docs/OPTIMIZATION.md",
        source: "planner",
        objectId: proposal.objectId,
        level: "account",
      }));
    } else if (proposal.id === "event-alignment-review") {
      cards.push(card({
        id: `planner-${proposal.id}`,
        group: "fix",
        title: "This ad set optimises for checkouts, not purchases",
        what: `Test one copy of the ad set optimised for ${proposal.evidence?.desiredEvent || "PURCHASE"} instead of ${proposal.evidence?.currentEvent || "the current event"}.`,
        why: "Meta finds more of whatever you ask it to find. Asking for checkouts brings people who start but may not finish; asking for purchases brings buyers. " + (proposal.counterevidence || ""),
        evidence: [
          { label: "Optimising for now", value: proposal.evidence?.currentEvent || "unknown", format: "text" },
          { label: "Wanted", value: proposal.evidence?.desiredEvent || "PURCHASE", format: "text" },
          ...evidence,
        ],
        expectedEffect: "Fewer, better results per dollar once the purchase event has enough volume.",
        risk: "medium",
        riskNote: "Only after tracking is verified. Keep the current ad set running while the copy is tested.",
        nextStep: "Preview the change with the dry run below; nothing is sent.",
        command: `node src/index.js adsets create '{"campaignId":"<campaign id>","name":"Purchase test","dailyBudget":10,"optimizationGoal":"OFFSITE_CONVERSIONS","pixelId":"<pixel id>","customEventType":"PURCHASE","targeting":{}}' --dry-run`,
        recipe: "recipes/update-adset-optimization-goal",
        source: "planner",
        objectId: proposal.objectId,
        level: "adset",
      }));
    } else if (String(proposal.id).startsWith("creative-control")) {
      const candidate = proposal.evidence?.candidate || {};
      cards.push(card({
        id: `planner-${proposal.id}`,
        group: "scale",
        title: `"${candidate.name || "Your most-shown ad"}" is the one to beat`,
        what: "Keep it running as the control and test one challenger with a different opening line or proof.",
        why: `It has had the most spend (${fmtMoney(candidate.metrics?.spend ?? null, currency)} in 7 days), so it is the fairest benchmark. ${proposal.counterevidence || ""}`.trim(),
        evidence: [
          { label: "Spent (7 days)", value: round(candidate.metrics?.spend ?? null), format: "currency" },
          { label: "Clicks", value: candidate.metrics?.clicks ?? null, format: "integer" },
          { label: "Purchases", value: candidate.metrics?.purchases ?? null, format: "integer" },
          { label: "Other ads in play", value: (proposal.evidence?.otherAds || []).length, format: "integer" },
        ],
        expectedEffect: "A clear winner after a week of equal spend, instead of guessing.",
        risk: "low",
        riskNote: "The new ad is created paused. Nothing changes until you activate it.",
        nextStep: "Draft the challenger with the carousel template, then create it paused.",
        command: "node src/index.js creatives carousel --example",
        recipe: "recipes/create-carousel-creative",
        source: "planner",
        objectId: proposal.objectId,
        level: "ad",
        objectName: candidate.name || null,
      }));
    } else {
      cards.push(card({
        id: `planner-${proposal.id}`,
        group: "watch",
        title: proposal.title || "Review this proposal",
        what: proposal.proposedAction || "Review the proposal in the optimizer report.",
        why: proposal.counterevidence || "The optimizer flagged this for a human decision.",
        evidence,
        expectedEffect: proposal.expectedOutcome || "A reviewed decision.",
        risk: "low",
        riskNote: "Proposal only; nothing is applied from here.",
        nextStep: "Read data/optimization/<account>/latest-report.md.",
        command: "node bin/optimize.js --dry-run",
        source: "planner",
        objectId: proposal.objectId,
      }));
    }
  }
  return cards;
}

// One card when cached ads carry text Meta is likely to reject or restrict.
// Read-only: it runs the offline policy check over the cached creatives.
function policyRiskCard(cache) {
  let risky;
  try {
    risky = policyCheck.cachedAdRisks(undefined, cache.ads || []);
  } catch {
    return null;
  }
  if (!risky.length) return null;
  const blocked = risky.filter((item) => item.status === "BLOCK");
  const first = risky[0];
  return card({
    id: "policy-risk",
    group: "fix",
    title: `${risky.length} ad${risky.length === 1 ? " carries" : "s carry"} policy risk`,
    what: blocked.length
      ? `Rewrite the flagged lines in ${blocked.length} ad${blocked.length === 1 ? "" : "s"} before Meta rejects ${blocked.length === 1 ? "it" : "them"}.`
      : "Check the flagged lines; they may limit delivery or need a special ad category.",
    why: "The agent read the cached ad text against Meta's Advertising Standards. Rejected ads stop delivering, and repeated rejections can restrict the ad account.",
    evidence: [
      { label: "Ads that would be refused", value: blocked.length, format: "integer" },
      { label: "Ads to check", value: risky.length - blocked.length, format: "integer" },
      { label: "Rules hit", value: [...new Set(risky.flatMap((item) => item.ruleIds))].slice(0, 6).join(", "), format: "text" },
    ],
    expectedEffect: "Fewer rejections and a healthier ad account.",
    risk: "low",
    riskNote: "Reading only. Nothing changes until you edit and recreate the ad.",
    nextStep: `Run node src/index.js policy check ${first.id} to see each phrase and a suggested rewrite.`,
    command: null,
    recipe: "recipes/policy-check",
    source: "rules",
    objectId: first.id,
    level: "ad",
    objectName: first.name,
  });
}

async function improvements(options = {}) {
  const cache = loadCache(options.dataDir || DEFAULT_DATA_DIR);
  if (!cache.hasData || !cache.campaigns.length) return redactValue(emptyState("improvements", cache));
  const env = envPresence();
  const rowsByLevel = { campaign: joinLevel(cache, "campaign"), adset: joinLevel(cache, "adset"), ad: joinLevel(cache, "ad") };
  const seenObjects = new Set();
  const cards = [];
  for (const item of [...plannerCards(cache), ...ruleCards(cache, rowsByLevel, env)]) {
    const key = `${item.group}:${item.level}:${item.objectId}`;
    if (item.objectId && seenObjects.has(key)) continue;
    seenObjects.add(key);
    cards.push(item);
  }
  const policyCard = policyRiskCard(cache);
  if (policyCard) cards.push(policyCard);
  const order = ["stop", "scale", "fix", "watch"];
  cards.sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group));
  const groups = order.map((key) => ({ key, ...GROUPS[key], cards: cards.filter((item) => item.group === key) }));
  const noInsights = !cache.byCampaign.length && !cache.byAdset.length;
  return redactValue({
    ok: true,
    empty: false,
    account: accountSummary(cache),
    currency: cache.currency,
    window: "Last 30 days at the last refresh",
    note: noInsights
      ? "Per-campaign numbers arrive with the next refresh; until then only the optimizer's proposals are shown."
      : cards.length ? null : "Nothing stands out right now. Everything that spends is getting results at a reasonable cost, or is too new to judge.",
    writesEnabled: env.writesEnabled,
    budgetCap: env.budgetCap,
    groups,
    total: cards.length,
    contract: "Every card is a proposal. The commands are dry runs; the agent never applies a change from this page.",
    plannerStatus: cache.optimization.report?.status || null,
    plannerWarnings: (cache.optimization.report?.warnings || []).map((item) => item.code),
    lastSync: cache.lastSync?.timestamp || null,
  });
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

function pctWord(change) {
  if (change === null) return null;
  const abs = Math.abs(change);
  if (abs < 1) return "about the same as";
  return `${abs.toFixed(0)}% ${change > 0 ? "more than" : "less than"}`;
}

async function summary(options = {}) {
  const cache = loadCache(options.dataDir || DEFAULT_DATA_DIR);
  if (!cache.hasData || (!cache.insights.length && !cache.daily.length)) return redactValue(emptyState("summary", cache));
  const env = envPresence();
  const period = resolvePeriod(cache, options.period || "7d");
  const primary = primaryResultType(cache);
  const current = metricsFromRows(period.current, primary);
  const previous = period.previous.length ? metricsFromRows(period.previous, primary) : null;
  const currency = cache.currency;
  const money = (value) => fmtMoney(value, currency);
  const label = (current?.resultLabel || "results").toLowerCase();
  const singular = current?.resultSingular || "result";
  const sentences = [];
  const push = (key, text, numbers) => sentences.push({ key, text: redactString(text), numbers });

  const spendChange = changePct(current.spend, previous?.spend ?? null);
  push("spent", `${period.label}, you spent ${money(current.spend)}${spendChange !== null ? `, ${pctWord(spendChange)} the ${period.days} days before (${money(previous.spend)})` : ""}.`, { spend: current.spend, previousSpend: previous?.spend ?? null, changePct: spendChange });

  if (current.results > 0) {
    const resultChange = changePct(current.results, previous?.results ?? null);
    push("got", `You got ${current.results} ${current.results === 1 ? singular : label}${resultChange !== null ? `, ${pctWord(resultChange)} before (${previous.results})` : ""}. It was shown ${current.impressions.toLocaleString("en-US")} times and clicked ${current.clicks.toLocaleString("en-US")} times.`, { results: current.results, previousResults: previous?.results ?? null, changePct: resultChange, impressions: current.impressions, clicks: current.clicks });
    const cprChange = changePct(current.costPerResult, previous?.costPerResult ?? null);
    push("cost", `Each ${singular} cost ${money(current.costPerResult)}${cprChange !== null ? `, ${pctWord(cprChange)} before (${money(previous.costPerResult)})` : ""}.`, { costPerResult: current.costPerResult, previousCostPerResult: previous?.costPerResult ?? null, changePct: cprChange });
  } else {
    push("got", `No ${label === "results" ? "results" : label} were recorded in this period: ${current.impressions.toLocaleString("en-US")} views and ${current.clicks.toLocaleString("en-US")} clicks, but nothing Meta counts as a result.`, { results: 0, impressions: current.impressions, clicks: current.clicks });
  }
  if (current.purchaseValue !== null && current.purchaseValue > 0) {
    push("sales", `Those purchases were worth ${money(current.purchaseValue)}, a return of ${current.roas !== null ? `${current.roas.toFixed(2)}x` : "n/a"} on what you spent.`, { purchaseValue: current.purchaseValue, roas: current.roas });
  }

  // What changed, what works, what wastes money.
  const rowsByLevel = { campaign: joinLevel(cache, "campaign"), adset: joinLevel(cache, "adset"), ad: joinLevel(cache, "ad") };
  const improvementData = cache.campaigns.length ? [...plannerCards(cache), ...ruleCards(cache, rowsByLevel, env)] : [];
  const working = rowsByLevel.campaign.filter((row) => row.results >= 3 && row.costPerResult !== null).sort((a, b) => a.costPerResult - b.costPerResult).slice(0, 3);
  const wasting = improvementData.filter((item) => item.group === "stop");
  const scaleCards = improvementData.filter((item) => item.group === "scale");
  const fixCards = improvementData.filter((item) => item.group === "fix");

  if (previous) {
    const ctrChange = changePct(current.ctr, previous.ctr);
    const cpmChange = changePct(current.cpm, previous.cpm);
    push("changed", `Compared with the ${period.days} days before: the click rate is ${pctWord(ctrChange) || "unchanged from"} before (${current.ctr ?? "n/a"}% vs ${previous.ctr ?? "n/a"}%), and each 1,000 views cost ${pctWord(cpmChange) || "the same as"} before (${money(current.cpm)} vs ${money(previous.cpm)}).`, { ctr: current.ctr, previousCtr: previous.ctr, cpm: current.cpm, previousCpm: previous.cpm });
  } else if (period.note) {
    push("changed", period.note, {});
  }

  const activeCampaigns = rowsByLevel.campaign.filter((row) => row.active);
  if (working.length) {
    push("working", `Working: ${working.map((row) => `"${row.name}" (${row.results} ${label} at ${money(row.costPerResult)} each)`).join("; ")}.`, { campaigns: working.map((row) => ({ id: row.id, name: row.name, results: row.results, costPerResult: row.costPerResult })) });
  } else if (activeCampaigns.length) {
    push("working", `${activeCampaigns.length} campaign${activeCampaigns.length === 1 ? " is" : "s are"} running. None has enough results yet (3 or more in 30 days) to call a winner.`, { activeCampaigns: activeCampaigns.length });
  } else if (cache.campaigns.length) {
    push("working", `Nothing is running right now: all ${cache.campaigns.length} campaigns are paused or finished.`, { campaigns: cache.campaigns.length });
  }
  if (wasting.length) {
    const total = wasting.reduce((sum, item) => sum + (item.evidence.find((row) => row.label.startsWith("Spent"))?.value || 0), 0);
    push("wasting", `Wasting money: ${wasting.map((item) => `"${item.objectName}" (${money(item.evidence.find((row) => row.label.startsWith("Spent"))?.value ?? null)}, no results)`).join("; ")}. Together that is ${money(total)} in 30 days with nothing to show.`, { items: wasting.map((item) => ({ id: item.objectId, name: item.objectName, level: item.level })), total: round(total) });
  } else if (rowsByLevel.campaign.some((row) => row.spend > 0)) {
    push("wasting", "Nothing is clearly wasting money: everything that spent in the last 30 days produced results or is too new to judge.", {});
  }

  const nextSteps = [...wasting, ...scaleCards, ...fixCards].slice(0, 3);
  if (nextSteps.length) {
    push("next", `Next: ${nextSteps.map((item, index) => `${index + 1}) ${item.what.replace(/\.$/, "")}`).join("; ")}. Each has a dry-run command on the Improvements tab; nothing is applied until you run it yourself.`, { steps: nextSteps.map((item) => ({ id: item.id, group: item.group, title: item.title, command: item.command })) });
  } else {
    push("next", "Next: nothing urgent. Refresh in a few days and look again.", { steps: [] });
  }

  // Budget cap and controls.
  const cap = env.budgetCap;
  const highest = Math.max(0, ...[...rowsByLevel.campaign, ...rowsByLevel.adset].filter((row) => row.active && row.budget.type === "daily").map((row) => row.budget.cents || 0));
  if (cap.limitCents) {
    const pct = highest ? Math.round((highest / cap.limitCents) * 100) : 0;
    push("cap", `Budget cap: the agent refuses any daily budget above ${money(cap.limitCents / 100)}${cap.source === "default" ? " (the default; set META_ADS_MAX_DAILY_BUDGET_CENTS to change it)" : ""}. Your highest active daily budget is ${money(highest / 100)}, ${pct}% of the cap.`, { capCents: cap.limitCents, highestDailyBudgetCents: highest, pctOfCap: pct, source: cap.source });
  } else {
    push("cap", "Budget cap: META_ADS_MAX_DAILY_BUDGET_CENTS is set to an invalid value, so every budget write is refused until it is fixed.", { capCents: null, source: cap.source });
  }
  const syncAge = hoursSince(cache.lastSync?.timestamp);
  push("refreshed", `Data last refreshed ${cache.lastSync?.timestamp ? `${syncAge} hours ago (${cache.lastSync.timestamp.slice(0, 16).replace("T", " ")} UTC)` : "at an unknown time"}${syncAge !== null && syncAge > STALE_AFTER_HOURS ? "; press Refresh for today's numbers" : ""}.`, { lastSync: cache.lastSync?.timestamp || null, ageHours: syncAge, stale: syncAge !== null && syncAge > STALE_AFTER_HOURS });
  push("writes", env.writesEnabled
    ? "Live writes are ON: commands run without --dry-run will change your ad account (each still asks for a typed confirmation)."
    : "Live writes are OFF: the agent can only read and preview. Set META_ADS_WRITES_ENABLED=true yourself to allow changes.", { writesEnabled: env.writesEnabled });

  return redactValue({
    ok: true,
    empty: false,
    account: accountSummary(cache),
    currency,
    period: { key: period.key, label: period.label, since: period.since, until: period.until, days: period.days, comparison: period.comparison, source: period.source },
    headline: current.results > 0
      ? `${money(current.spend)} spent, ${current.results} ${current.results === 1 ? singular : label} at ${money(current.costPerResult)} each.`
      : `${money(current.spend)} spent, no results recorded.`,
    sentences,
    controls: { writesEnabled: env.writesEnabled, budgetCap: cap, highestDailyBudgetCents: highest, lastSync: cache.lastSync?.timestamp || null, stale: syncAge !== null && syncAge > STALE_AFTER_HOURS },
    generatedAt: new Date().toISOString(),
  });
}

// ---------------------------------------------------------------------------
// Freshness and refresh
// ---------------------------------------------------------------------------

async function freshness(options = {}) {
  const dataDir = options.dataDir || DEFAULT_DATA_DIR;
  const cache = loadCache(dataDir);
  const env = envPresence();
  const age = hoursSince(cache.lastSync?.timestamp);
  const files = {};
  for (const name of ["account", "campaigns", "adsets", "ads", "insights", "insights-daily", "insights-campaigns", "insights-adsets", "insights-ads", "last-sync"]) {
    files[name] = fs.existsSync(path.join(dataDir, `${name}.json`));
  }
  return redactValue({
    ok: true,
    lastSync: cache.lastSync?.timestamp || null,
    ageHours: age,
    stale: age === null || age > STALE_AFTER_HOURS,
    syncErrors: cache.lastSync?.errors && Object.keys(cache.lastSync.errors).length ? cache.lastSync.errors : null,
    hasData: cache.hasData,
    hasDailySeries: cache.daily.length > 0,
    hasLevelInsights: cache.byCampaign.length > 0 || cache.byAdset.length > 0,
    credentialsConfigured: env.configured,
    missing: env.missing,
    required: env.required,
    refreshPossible: env.configured,
    refreshBlocker: env.configured ? null : `Add ${env.missing.join(", ")} to agents/meta-ads/.env, then run doctor.`,
    writesEnabled: env.writesEnabled,
    budgetCap: env.budgetCap,
    account: accountSummary(cache),
    files,
    envFile: "agents/meta-ads/.env",
    setupDoc: "docs/SETUP.md",
    agentVersion: safeVersion(),
  });
}

function safeVersion() {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version || null;
  } catch {
    return null;
  }
}

/**
 * Runs the agent's own read-only sync in a child process so the caller (the
 * Mission Control server) never loads credentials into its own process. The
 * child's output is redacted again before it is returned.
 */
async function refresh(options = {}) {
  const env = envPresence();
  if (!env.configured) {
    return redactValue({ ok: false, ran: false, error: `Refresh needs Meta credentials. Missing: ${env.missing.join(", ")}. Add them to agents/meta-ads/.env and run doctor.`, missing: env.missing });
  }
  const child = spawnSync(process.execPath, [path.join(ROOT, "src/index.js"), "refresh"], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: options.timeoutMs || 180000,
    env: { ...process.env, ...(options.env || {}) },
  });
  const output = redactString(`${child.stdout || ""}${child.stderr ? `\n${child.stderr}` : ""}`.trim());
  const after = await freshness(options);
  return redactValue({
    ok: child.status === 0,
    ran: true,
    exitCode: child.status,
    timedOut: Boolean(child.error && child.error.code === "ETIMEDOUT"),
    output,
    error: child.status === 0 ? null : (child.error ? child.error.message : output.split("\n").filter((line) => /error|failed/i.test(line)).join("\n") || "Refresh did not complete."),
    lastSync: after.lastSync,
    syncErrors: after.syncErrors,
  });
}

async function section(name, options = {}) {
  switch (name) {
    case "overview": return overview(options);
    case "ads": return ads(options);
    case "improvements": return improvements(options);
    case "summary": return summary(options);
    case "freshness": return freshness(options);
    case "all": {
      const out = {};
      for (const key of SECTIONS) out[key] = await section(key, options);
      return out;
    }
    default:
      throw new Error(`Unknown dashboard section: ${name}. Use one of ${SECTIONS.join(", ")}.`);
  }
}

module.exports = {
  SECTIONS,
  PERIODS,
  RESULT_TYPES,
  overview,
  ads,
  improvements,
  summary,
  freshness,
  refresh,
  section,
  // exported for tests
  metricsFromRows,
  primaryResultType,
  resolvePeriod,
  loadCache,
};
