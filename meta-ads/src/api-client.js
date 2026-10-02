#!/usr/bin/env node

/**
 * Meta Marketing API Client
 *
 * Wraps the Meta (Facebook) Graph API for ads management.
 * All calls go through graph.facebook.com/<apiVersion> (config.json, currently v25.0).
 *
 * Required env vars:
 *   META_ADS_ACCESS_TOKEN  - Long-lived user or system user token
 *   META_ADS_ACCOUNT_ID    - Ad account ID (format: act_XXXXXXXXX)
 */

const p = require("path");
let dotenv = null;
try {
  dotenv = require("dotenv");
} catch (error) {
  if (error.code !== "MODULE_NOT_FOUND") throw error;
}
if (dotenv) {
  try {
    dotenv.config({ path: p.join(__dirname, "../.env") });
  } catch (error) {
    if (error.code !== "MODULE_NOT_FOUND") throw error;
    // dotenv is optional; real environment variables still work without it.
  }
}


const config = require("../config/config.json");
const {
  buildJsonFetchOptions,
  setUrlSearchParams,
  throwConfiguredApiError,
} = require("./api-client-helpers");
const { writeAudit, sanitize } = require("./audit-log");
const { RateLimiter } = require("./rate-limiter");
const { checkDailyBudgetLimit, writeGate } = require("./recipe-helpers");
const fs = require("fs");
const carousel = require("./carousel");

const BASE = `${config.baseUrl}/${config.apiVersion}`;
const TOKEN = process.env.META_ADS_ACCESS_TOKEN;
const ACCOUNT_ID = process.env.META_ADS_ACCOUNT_ID;
const rateLimiter = new RateLimiter();
let dryRunEnabled = false;
let dryRunCounter = 0;
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_PAGINATION_PAGES = 100;
const ASYNC_INSIGHTS_REQUEST = Symbol("asyncInsightsRequest");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function setDryRun(enabled) {
  dryRunEnabled = Boolean(enabled);
}

function isRetryable(status, error) {
  return [429, 500, 502, 503].includes(status)
    || error?.is_transient === true
    || error?.code === 2;
}

function checkCredentials() {
  if (!TOKEN) throw new Error("META_ADS_ACCESS_TOKEN not set in .env");
  if (!ACCOUNT_ID) throw new Error("META_ADS_ACCOUNT_ID not set in .env");
}

async function apiCall(endpoint, method = "GET", body = null, params = {}, options = {}) {
  const isWrite = method.toUpperCase() !== "GET";
  const useDryRun = isWrite && (dryRunEnabled || options.dryRun === true);
  const auditRequest = { endpoint, method, body, params };

  if (useDryRun) {
    const result = { id: `dry_run_${++dryRunCounter}`, dryRun: true };
    console.error(`Meta Ads dry run: ${JSON.stringify(sanitize(auditRequest))}`);
    writeAudit(`${method} ${endpoint}`, auditRequest, { ...result, dryRun: true });
    return result;
  }

  // Async Insights report creation is a read-only data export request despite
  // Meta modelling it as POST. Keep this exception narrow rather than letting
  // callers bypass the write gate with a generic option.
  if (isWrite && options.asyncInsightsRequest !== ASYNC_INSIGHTS_REQUEST) {
    writeGate(`Meta API ${method.toUpperCase()} ${endpoint}`);
  }

  try {
    checkCredentials();
    const url = new URL(`${BASE}${endpoint}`);
    url.searchParams.set("access_token", TOKEN);
    setUrlSearchParams(url, params, { stringifyObjectValues: true });

    const maxAttempts = isWrite ? 1 : 4;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await rateLimiter.waitIfNeeded();
      const fetchOptions = buildJsonFetchOptions({ method, body });
      fetchOptions.signal = AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      const res = await fetch(url.toString(), fetchOptions);
      rateLimiter.parseBucHeader(res.headers.get("x-business-use-case-usage"));

      let data;
      try {
        data = await res.json();
      } catch {
        data = { error: { message: `HTTP ${res.status}`, code: res.status } };
      }
      const apiError = data?.error;

      if (!isWrite && isRetryable(res.status, apiError) && attempt < maxAttempts - 1) {
        await sleep(2 ** attempt * 1000);
        continue;
      }

      if (isWrite && isRetryable(res.status, apiError)) {
        throw new Error(`Meta API write request failed without replay (${res.status}). Verify whether the change was applied before retrying.`);
      }

      if (!res.ok && !apiError) {
        throw new Error(`Meta API Error: HTTP ${res.status}`);
      }
      const result = throwConfiguredApiError(data, { type: "meta" });
      if (isWrite) writeAudit(`${method} ${endpoint}`, auditRequest, result);
      return result;
    }

    throw new Error("Request failed after max retries");
  } catch (error) {
    if (isWrite) writeAudit(`${method} ${endpoint}`, auditRequest, { error: error.message });
    throw error;
  }
}

function cursorFromNextUrl(next, endpoint) {
  let nextUrl;
  const expected = new URL(`${BASE}${endpoint}`);
  try {
    nextUrl = new URL(next);
  } catch {
    throw new Error("Unsafe pagination next URL: invalid URL");
  }
  // Meta may upgrade an older requested version in its continuation URL.
  // Reuse only the cursor; subsequent requests still use our original endpoint.
  const resourcePath = (url) => url.pathname.replace(/^\/v\d+\.\d+(?=\/)/, "");
  if (nextUrl.origin !== expected.origin || resourcePath(nextUrl) !== resourcePath(expected)) {
    throw new Error("Unsafe pagination next URL: origin or path changed");
  }
  const cursor = nextUrl.searchParams.get("after");
  if (!cursor) throw new Error("Unsafe pagination next URL: missing cursor");
  return cursor;
}

async function getPaginated(endpoint, params = {}) {
  const allData = [];
  const seenCursors = new Set();
  let pageParams = { ...params };
  let lastPage = null;

  for (let page = 0; page < MAX_PAGINATION_PAGES; page++) {
    const result = await apiCall(endpoint, "GET", null, pageParams);
    if (!Array.isArray(result?.data)) {
      throw new Error("Malformed Meta collection response: expected a data array");
    }
    lastPage = result;
    allData.push(...result.data);
    const next = result?.paging?.next;
    if (!next) return { ...lastPage, data: allData };
    const cursor = cursorFromNextUrl(next, endpoint);
    if (seenCursors.has(cursor)) throw new Error("Pagination cursor cycle detected");
    seenCursors.add(cursor);
    pageParams = { ...params, after: cursor };
  }
  throw new Error(`Pagination exceeded ${MAX_PAGINATION_PAGES} pages`);
}

// ── Campaign Management ──────────────────────────────────────────

async function listCampaigns(fields = "id,name,status,objective,daily_budget,lifetime_budget,start_time,stop_time,created_time") {
  return getPaginated(`/${ACCOUNT_ID}/campaigns`, {
    fields,
    limit: 100,
  });
}

async function getCampaign(campaignId, fields = "id,name,status,objective,daily_budget,lifetime_budget,insights{spend,impressions,clicks,ctr,cpc,cpm,reach,actions}") {
  return apiCall(`/${campaignId}`, "GET", null, { fields });
}

async function createCampaign({ name, objective, status = "PAUSED", dailyBudget, lifetimeBudget, specialAdCategories = [] }, dryRun = false) {
  const body = {
    name,
    objective,
    status,
    special_ad_categories: specialAdCategories,
    // Meta requires this explicitly when the campaign is NOT using campaign-level budget (CBO).
    // false = each ad set keeps its own budget (clean A/B); true = ad sets share 20% for auto-optimization.
    is_adset_budget_sharing_enabled: false,
  };
  if (dailyBudget) body.daily_budget = Math.round(dailyBudget * 100); // cents
  if (lifetimeBudget) body.lifetime_budget = Math.round(lifetimeBudget * 100);
  return apiCall(`/${ACCOUNT_ID}/campaigns`, "POST", body, {}, { dryRun });
}

async function updateCampaign(campaignId, updates, dryRun = false) {
  return apiCall(`/${campaignId}`, "POST", updates, {}, { dryRun });
}

async function pauseCampaign(campaignId, dryRun = false) {
  return updateCampaign(campaignId, { status: "PAUSED" }, dryRun);
}

async function activateCampaign(campaignId, dryRun = false) {
  return updateCampaign(campaignId, { status: "ACTIVE" }, dryRun);
}

// ── Ad Set Management ────────────────────────────────────────────

async function listAdSets(campaignId = null, fields = "id,name,status,effective_status,campaign_id,daily_budget,lifetime_budget,targeting,optimization_goal,bid_strategy,start_time,end_time") {
  const endpoint = campaignId ? `/${campaignId}/adsets` : `/${ACCOUNT_ID}/adsets`;
  return getPaginated(endpoint, { fields, limit: 100 });
}

async function createAdSet({ campaignId, name, dailyBudget, targeting, optimizationGoal, billingEvent = "IMPRESSIONS", bidStrategy = "LOWEST_COST_WITHOUT_CAP", destinationType = "WEBSITE", status = "PAUSED", startTime, endTime }, dryRun = false) {
  const body = {
    campaign_id: campaignId,
    name,
    daily_budget: Math.round(dailyBudget * 100),
    targeting: {
      ...targeting,
      targeting_automation: targeting?.targeting_automation || { advantage_audience: 0 },
    },
    optimization_goal: optimizationGoal,
    billing_event: billingEvent,
    bid_strategy: bidStrategy,
    destination_type: destinationType,
    status,
  };
  if (startTime) body.start_time = startTime;
  if (endTime) body.end_time = endTime;
  return apiCall(`/${ACCOUNT_ID}/adsets`, "POST", body, {}, { dryRun });
}

// ── Ad Creative & Ads ────────────────────────────────────────────

async function listAds(adSetId = null, fields = "id,name,status,campaign_id,creative{id,title,body,image_url,thumbnail_url,url_tags,object_story_spec},insights{spend,impressions,clicks,ctr,cpc}") {
  const endpoint = adSetId ? `/${adSetId}/ads` : `/${ACCOUNT_ID}/ads`;
  return getPaginated(endpoint, { fields, limit: 100 });
}

async function createAdCreative({ name, pageId, instagramUserId, message, link, imageHash, imageUrl, callToAction = "LEARN_MORE" }, dryRun = false) {
  const body = {
    name,
    object_story_spec: {
      page_id: pageId,
      link_data: {
        message,
        link,
        call_to_action: { type: callToAction },
      },
    },
  };
  if (instagramUserId) body.object_story_spec.instagram_user_id = instagramUserId;
  if (imageHash) body.object_story_spec.link_data.image_hash = imageHash;
  if (imageUrl) body.image_url = imageUrl;
  return apiCall(`/${ACCOUNT_ID}/adcreatives`, "POST", body, {}, { dryRun });
}

async function createAd({ adSetId, creativeId, name, status = "PAUSED" }, dryRun = false) {
  return apiCall(`/${ACCOUNT_ID}/ads`, "POST", {
    adset_id: adSetId,
    creative: { creative_id: creativeId },
    name,
    status,
  }, {}, { dryRun });
}

async function createCarouselCreative(input, dryRun = false) {
  const { spec, warnings } = carousel.validateCarouselSpec(input);
  const hashesByCard = {};
  const uploads = [];
  const uploadedPaths = new Map();

  for (let index = 0; index < spec.cards.length; index += 1) {
    const card = spec.cards[index];
    const cardNumber = index + 1;
    if (card.imageHash) {
      uploads.push({ card: cardNumber, source: "imageHash", hash: card.imageHash });
      continue;
    }
    const source = card.image;
    const cacheKey = /^https?:\/\//i.test(source) ? null : p.resolve(source);
    if (cacheKey && uploadedPaths.has(cacheKey)) {
      const previous = uploadedPaths.get(cacheKey);
      hashesByCard[cardNumber] = previous.hash;
      uploads.push({ card: cardNumber, source: previous.source, bytes: previous.bytes, hash: previous.hash });
      continue;
    }
    const filePath = cacheKey ? source : undefined;
    const bytes = filePath ? fs.statSync(filePath).size : undefined;
    let image;
    try {
      image = await uploadAdImage({
        ...(filePath ? { filePath, name: p.basename(filePath) } : { url: source }),
      }, dryRun);
    } catch (error) {
      const completed = uploads.filter((upload) => upload.hash).map((upload) => `card ${upload.card} -> ${upload.hash}`).join(", ") || "none";
      throw new Error(`Card ${cardNumber} image upload failed: ${error.message}. Uploads already completed: ${completed}.`);
    }
    const isDryRun = image.response?.dryRun === true;
    const hash = isDryRun ? `DRY_RUN_HASH_${cardNumber}` : image.hash;
    if (!hash) throw new Error(`Card ${cardNumber} image upload returned no image hash`);
    hashesByCard[cardNumber] = hash;
    const upload = { card: cardNumber, source, ...(bytes == null ? {} : { bytes }), hash };
    uploads.push(upload);
    if (cacheKey) uploadedPaths.set(cacheKey, upload);
  }

  const previewBody = carousel.buildCarouselCreativeBody(spec, hashesByCard, { dryRun: dryRun || dryRunEnabled });
  const endpoint = `/${ACCOUNT_ID || "act_<ACCOUNT_ID>"}/adcreatives`;
  const response = await apiCall(endpoint, "POST", previewBody, {}, { dryRun });
  const isDryRun = response?.dryRun === true;
  const summary = {
    name: spec.name,
    cardCount: spec.cards.length,
    pageId: spec.pageId,
    ...(spec.instagramUserId ? { instagramUserId: String(spec.instagramUserId) } : {}),
    optimizeOrder: spec.optimizeOrder,
    endCard: spec.endCard,
  };
  return {
    dryRun: isDryRun,
    ...(isDryRun ? { id: response.id } : { creativeId: response.id }),
    summary,
    uploads,
    warnings,
    ...(isDryRun ? { request: { method: "POST", endpoint, body: previewBody } } : {
      next: `ads create '{"adSetId":"<ADSET_ID>","creativeId":"${response.id}","name":"<ad name>"}' (created PAUSED; review before activation)`,
    }),
  };
}

// ── Images ───────────────────────────────────────────────────────

function imageHashFromResponse(response) {
  if (response?.hash) return response.hash;
  const image = Object.values(response?.images || {})[0];
  return image?.hash || null;
}

async function uploadAdImage({ filePath, url, name } = {}, dryRun = false) {
  if (!filePath && !url) throw new Error("Provide filePath or url for the ad image");

  const body = {};
  if (filePath) {
    if (!fs.existsSync(filePath)) throw new Error(`Image file not found: ${filePath}`);
    body.bytes = fs.readFileSync(filePath).toString("base64");
    body.name = name || require("path").basename(filePath);
  } else {
    body.url = url;
    if (name) body.name = name;
  }

  const response = await apiCall(`/${ACCOUNT_ID || "act_<ACCOUNT_ID>"}/adimages`, "POST", body, {}, { dryRun });
  return { hash: imageHashFromResponse(response), response };
}

async function listAdImages(fields = "hash,name,url,width,height,created_time") {
  return getPaginated(`/${ACCOUNT_ID}/adimages`, { fields, limit: 100 });
}

// ── Budgets ──────────────────────────────────────────────────────

async function updateBudget(objectId, dailyBudgetCents, { dryRun = false } = {}) {
  checkDailyBudgetLimit(dailyBudgetCents, "update budget");
  writeGate("update budget");
  return apiCall(`/${objectId}`, "POST", { daily_budget: Number(dailyBudgetCents) }, {}, { dryRun });
}

// Changing optimization_goal resets the ad set's learning phase. Meta only
// accepts values valid for the ad set's campaign objective (e.g. an
// OUTCOME_SALES campaign with conversion_location=website accepts both
// OFFSITE_CONVERSIONS and LANDING_PAGE_VIEWS; other objectives narrow this).
// An invalid combination is rejected by the Graph API call itself, not
// silently accepted, so a bad value here fails loudly rather than corrupting
// delivery.
const VALID_OPTIMIZATION_GOALS = new Set([
  "LANDING_PAGE_VIEWS",
  "OFFSITE_CONVERSIONS",
  "LINK_CLICKS",
  "IMPRESSIONS",
  "REACH",
  "THRUPLAY",
  "LEAD_GENERATION",
  "QUALITY_LEAD",
  "VALUE",
  "APP_INSTALLS",
  "CONVERSATIONS",
  "POST_ENGAGEMENT",
]);

async function updateAdSetOptimizationGoal(adSetId, optimizationGoal, { dryRun = false } = {}) {
  const goal = String(optimizationGoal || "").trim().toUpperCase();
  if (!VALID_OPTIMIZATION_GOALS.has(goal)) {
    throw new Error(
      `update ad set optimization goal: "${optimizationGoal}" is not a recognised Meta optimization_goal`
    );
  }
  writeGate("update ad set optimization goal");
  return apiCall(`/${adSetId}`, "POST", { optimization_goal: goal }, {}, { dryRun });
}

// ── Targeting ────────────────────────────────────────────────────

async function searchTargeting({ q, type = "adinterest", limit = 25 } = {}) {
  if (!q || !String(q).trim()) throw new Error("Targeting search query is required");
  return apiCall("/search", "GET", null, { q: String(q).trim(), type, limit: Number(limit) });
}

async function searchLocations({ q, limit = 25 } = {}) {
  if (!q || !String(q).trim()) throw new Error("Location search query is required");
  return apiCall("/search", "GET", null, { q: String(q).trim(), type: "adgeolocation", limit: Number(limit) });
}

async function searchAdLibrary({ searchTerms, adReachedCountries, adType = "ALL", adActiveStatus = "ACTIVE", limit = 25 } = {}) {
  if (!searchTerms || !String(searchTerms).trim()) throw new Error("Ad Library search terms are required");
  if (!Array.isArray(adReachedCountries) || !adReachedCountries.length) {
    throw new Error("Ad Library reached countries are required");
  }
  return apiCall("/ads_archive", "GET", null, {
    search_terms: String(searchTerms).trim(),
    ad_reached_countries: adReachedCountries,
    ad_type: adType,
    ad_active_status: adActiveStatus,
    limit: Number(limit),
    fields: "id,page_name,ad_creative_bodies,ad_creative_link_titles,ad_delivery_start_time,publisher_platforms",
  });
}

async function getReachEstimate({ targetingSpec } = {}) {
  if (!targetingSpec || typeof targetingSpec !== "object") throw new Error("targetingSpec must be an object");
  return apiCall(`/${ACCOUNT_ID}/reachestimate`, "GET", null, { targeting_spec: targetingSpec });
}

// ── A/B Experiments ──────────────────────────────────────────────

async function listExperiments(fields = "id,name,type,start_time,end_time,created_time") {
  return getPaginated(`/${ACCOUNT_ID}/ad_studies`, { fields, limit: 100 });
}

async function createExperiment({ name, startTime, endTime, cells }, dryRun = false) {
  if (!name || !startTime || !endTime || !Array.isArray(cells) || !cells.length) {
    throw new Error("Experiment name, startTime, endTime, and at least one cell are required");
  }
  writeGate("experiments create");
  return apiCall(`/${ACCOUNT_ID}/ad_studies`, "POST", {
    name,
    start_time: startTime,
    end_time: endTime,
    cells: JSON.stringify(cells),
  }, {}, { dryRun });
}

async function getExperiment(experimentId, fields = "id,name,type,start_time,end_time,created_time") {
  return apiCall(`/${experimentId}`, "GET", null, { fields });
}

async function getExperimentResults(experimentId, fields = "id,name,campaign_id,adsets,ads") {
  return getPaginated(`/${experimentId}/cells`, { fields, limit: 100 });
}

// ── Automated Rules ──────────────────────────────────────────────

function stringifyRuleSpec(spec, label) {
  if (spec === undefined || spec === null) throw new Error(`${label} is required`);
  return typeof spec === "string" ? spec : JSON.stringify(spec);
}

function ruleUpdateBody({ status, evaluationSpec, executionSpec, scheduleSpec, ...rest } = {}) {
  const body = { ...rest };
  if (status !== undefined) body.status = status;
  if (evaluationSpec !== undefined) body.evaluation_spec = stringifyRuleSpec(evaluationSpec, "evaluationSpec");
  if (executionSpec !== undefined) body.execution_spec = stringifyRuleSpec(executionSpec, "executionSpec");
  if (scheduleSpec !== undefined) body.schedule_spec = stringifyRuleSpec(scheduleSpec, "scheduleSpec");
  return body;
}

async function listRules(fields = "id,name,status,evaluation_spec,execution_spec,schedule_spec,created_time,updated_time") {
  return getPaginated(`/${ACCOUNT_ID}/adrules_library`, { fields, limit: 100 });
}

async function getRule(ruleId, fields = "id,name,status,evaluation_spec,execution_spec,schedule_spec,created_time,updated_time") {
  return apiCall(`/${ruleId}`, "GET", null, { fields });
}

async function createRule({ name, evaluationSpec, executionSpec, scheduleSpec }, dryRun = false) {
  if (!name) throw new Error("Rule name is required");
  writeGate("rules create");
  return apiCall(`/${ACCOUNT_ID}/adrules_library`, "POST", {
    name,
    evaluation_spec: stringifyRuleSpec(evaluationSpec, "evaluationSpec"),
    execution_spec: stringifyRuleSpec(executionSpec, "executionSpec"),
    schedule_spec: stringifyRuleSpec(scheduleSpec, "scheduleSpec"),
  }, {}, { dryRun });
}

async function updateRule(ruleId, updates, dryRun = false) {
  writeGate("rules update");
  return apiCall(`/${ruleId}`, "POST", ruleUpdateBody(updates), {}, { dryRun });
}

async function deleteRule(ruleId, dryRun = false) {
  writeGate("rules delete");
  return apiCall(`/${ruleId}`, "DELETE", null, {}, { dryRun });
}

// ── Lead Forms ───────────────────────────────────────────────────

const LEADFORM_LIST = "id,name,status,locale,created_time,leads_count,questions,privacy_policy_url";
const LEAD_LIST = "id,created_time,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,form_id,field_data";

async function listLeadForms(pageId, fields = LEADFORM_LIST) {
  return getPaginated(`/${pageId}/leadgen_forms`, { fields, limit: 100 });
}

async function getFormLeads(formId, fields = LEAD_LIST) {
  return getPaginated(`/${formId}/leads`, { fields, limit: 100 });
}

async function getLead(leadId, fields = LEAD_LIST) {
  return apiCall(`/${leadId}`, "GET", null, { fields });
}

// ── Insights & Reporting ─────────────────────────────────────────

async function getAccountInsights(timeRange = "last_30d", breakdown = null) {
  const params = {
    fields: "spend,impressions,reach,clicks,ctr,cpc,cpm,actions,action_values,cost_per_action_type,frequency",
    date_preset: timeRange,
  };
  if (breakdown) params.breakdowns = breakdown;
  return getPaginated(`/${ACCOUNT_ID}/insights`, params);
}

async function getCampaignInsights(campaignId, timeRange = "last_30d", breakdowns = null) {
  const params = {
    fields: "campaign_name,spend,impressions,reach,clicks,ctr,cpc,cpm,actions,cost_per_action_type,frequency,purchase_roas",
    date_preset: timeRange,
  };
  if (breakdowns) params.breakdowns = breakdowns;
  return getPaginated(`/${campaignId}/insights`, params);
}

async function getAdSetInsights(adSetId, timeRange = "last_30d", breakdowns = null) {
  const params = {
    fields: "adset_name,spend,impressions,reach,clicks,ctr,cpc,cpm,actions,cost_per_action_type",
    date_preset: timeRange,
  };
  if (breakdowns) params.breakdowns = breakdowns;
  return getPaginated(`/${adSetId}/insights`, params);
}

async function getAdInsights(adId, timeRange = "last_30d", breakdowns = null) {
  const params = {
    fields: "ad_name,spend,impressions,reach,clicks,ctr,cpc,cpm,actions,cost_per_action_type",
    date_preset: timeRange,
  };
  if (breakdowns) params.breakdowns = breakdowns;
  return getPaginated(`/${adId}/insights`, params);
}

async function createAsyncReport({ objectId, fields, breakdowns, timeRange = "last_30d", level } = {}) {
  if (!/^(?:act_)?\d+$/.test(String(objectId || ""))) {
    throw new Error("Async Insights requires a numeric object ID or act_ account ID");
  }
  if (!objectId) throw new Error("objectId is required for an async insights report");
  const body = {
    async: true,
    fields: fields || "spend,impressions,reach,clicks,ctr,cpc,cpm,actions",
  };
  if (breakdowns) body.breakdowns = breakdowns;
  if (level) body.level = level;
  if (typeof timeRange === "object") body.time_range = timeRange;
  else body.date_preset = timeRange;
  return apiCall(`/${objectId}/insights`, "POST", body, {}, { asyncInsightsRequest: ASYNC_INSIGHTS_REQUEST });
}

async function getAsyncReportStatus(reportRunId) {
  const report = await apiCall(`/${reportRunId}`, "GET", null, { fields: "id,async_status,async_percent_completion,date_start,date_stop" });
  if (report.async_status !== "Job Completed") return report;
  const insights = await getPaginated(`/${reportRunId}/insights`);
  return { ...report, insights };
}

// ── Audiences ────────────────────────────────────────────────────

// Meta deprecated `approximate_count` (removed by Graph v19+; this client is on
// v25.0). It now returns lower/upper bounds instead. Requesting the old field
// makes the whole `sync` command fail with "(#100) Tried accessing nonexisting
// field", which silently blocked every audience, campaign and insight cache
// from ever being written. Fixed 2026-09-02.
async function listCustomAudiences(fields = "id,name,approximate_count_lower_bound,approximate_count_upper_bound,subtype,time_created") {
  return getPaginated(`/${ACCOUNT_ID}/customaudiences`, { fields, limit: 100 });
}

async function createCustomAudience({ name, description, subtype = "CUSTOM", customerFileSource }, dryRun = false) {
  return apiCall(`/${ACCOUNT_ID}/customaudiences`, "POST", {
    name,
    description,
    subtype,
    customer_file_source: customerFileSource,
  }, {}, { dryRun });
}

async function createLookalikeAudience({ name, sourceAudienceId, country, ratio = 0.01 }, dryRun = false) {
  return apiCall(`/${ACCOUNT_ID}/customaudiences`, "POST", {
    name,
    subtype: "LOOKALIKE",
    origin_audience_id: sourceAudienceId,
    lookalike_spec: JSON.stringify({
      country,
      ratio,
      type: "similarity",
    }),
  }, {}, { dryRun });
}

// ── Pixel & Conversions ──────────────────────────────────────────

async function listPixels(fields = "id,name,last_fired_time,is_created_by_business") {
  return getPaginated(`/${ACCOUNT_ID}/adspixels`, { fields, limit: 100 });
}

async function getPixelStats(pixelId, timeRange = "last_30d") {
  return apiCall(`/${pixelId}/stats`, "GET", null, { date_preset: timeRange });
}

// ── Account Info ─────────────────────────────────────────────────

async function getAccountInfo() {
  return apiCall(`/${ACCOUNT_ID}`, "GET", null, {
    fields: "id,name,account_status,currency,timezone_name,amount_spent,balance,spend_cap,business",
  });
}

module.exports = {
  apiCall, setDryRun,
  listCampaigns, getCampaign, createCampaign, updateCampaign, pauseCampaign, activateCampaign,
  listAdSets, createAdSet,
  listAds, createAdCreative, createAd, createCarouselCreative,
  uploadAdImage, listAdImages,
  updateBudget,
  updateAdSetOptimizationGoal,
  searchTargeting, searchLocations, searchAdLibrary, getReachEstimate,
  listExperiments, createExperiment, getExperiment, getExperimentResults,
  listRules, getRule, createRule, updateRule, deleteRule,
  LEADFORM_LIST, LEAD_LIST, listLeadForms, getFormLeads, getLead,
  getAccountInsights, getCampaignInsights, getAdSetInsights, getAdInsights,
  createAsyncReport, getAsyncReportStatus,
  listCustomAudiences, createCustomAudience, createLookalikeAudience,
  listPixels, getPixelStats,
  getAccountInfo,
};
