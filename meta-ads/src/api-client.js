#!/usr/bin/env node

/**
 * Meta Marketing API Client
 *
 * Wraps the Meta (Facebook) Graph API for ads management.
 * All calls go through graph.facebook.com/v21.0.
 *
 * Required env vars:
 *   META_ADS_ACCESS_TOKEN  - Long-lived user or system user token
 *   META_ADS_ACCOUNT_ID    - Ad account ID (format: act_XXXXXXXXX)
 */

try {
  try {
  require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
} catch (error) {
  if (error.code !== "MODULE_NOT_FOUND") throw error;
  // dotenv is an optional convenience for loading a local .env file. When it is
  // not installed, credentials can still be supplied as real environment
  // variables without it; requiring this module must never crash on that alone.
}
} catch (error) {
  if (error.code !== "MODULE_NOT_FOUND") throw error;
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

const BASE = `${config.baseUrl}/${config.apiVersion}`;
const TOKEN = process.env.META_ADS_ACCESS_TOKEN;
const ACCOUNT_ID = process.env.META_ADS_ACCOUNT_ID;
const rateLimiter = new RateLimiter();
let dryRunEnabled = false;
let dryRunCounter = 0;

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

  try {
    checkCredentials();
    const url = new URL(`${BASE}${endpoint}`);
    url.searchParams.set("access_token", TOKEN);
    setUrlSearchParams(url, params, { stringifyObjectValues: true });

    for (let attempt = 0; attempt <= 3; attempt++) {
      await rateLimiter.waitIfNeeded();
      const fetchOptions = buildJsonFetchOptions({ method, body });
      if (options.timeoutMs) {
        fetchOptions.signal = AbortSignal.timeout(options.timeoutMs);
      }
      const res = await fetch(url.toString(), fetchOptions);
      rateLimiter.parseBucHeader(res.headers.get("x-business-use-case-usage"));

      let data;
      try {
        data = await res.json();
      } catch {
        data = { error: { message: `HTTP ${res.status}`, code: res.status } };
      }
      const apiError = data?.error;

      if (isRetryable(res.status, apiError) && attempt < 3) {
        await sleep(2 ** attempt * 1000);
        continue;
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

// ── Campaign Management ──────────────────────────────────────────

async function listCampaigns(fields = "id,name,status,objective,daily_budget,lifetime_budget,start_time,stop_time,created_time") {
  return apiCall(`/${ACCOUNT_ID}/campaigns`, "GET", null, {
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

async function listAdSets(campaignId = null, fields = "id,name,status,daily_budget,lifetime_budget,targeting,optimization_goal,bid_strategy,start_time,end_time") {
  const endpoint = campaignId ? `/${campaignId}/adsets` : `/${ACCOUNT_ID}/adsets`;
  return apiCall(endpoint, "GET", null, { fields, limit: 100 });
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

async function listAds(adSetId = null, fields = "id,name,status,creative{id,title,body,image_url,thumbnail_url},insights{spend,impressions,clicks,ctr,cpc}") {
  const endpoint = adSetId ? `/${adSetId}/ads` : `/${ACCOUNT_ID}/ads`;
  return apiCall(endpoint, "GET", null, { fields, limit: 100 });
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

  writeGate("images upload");
  const response = await apiCall(`/${ACCOUNT_ID}/adimages`, "POST", body, {}, { dryRun });
  return { hash: imageHashFromResponse(response), response };
}

async function listAdImages(fields = "hash,name,url,width,height,created_time") {
  return apiCall(`/${ACCOUNT_ID}/adimages`, "GET", null, { fields, limit: 100 });
}

// ── Budgets ──────────────────────────────────────────────────────

async function updateBudget(objectId, dailyBudgetCents, { dryRun = false } = {}) {
  checkDailyBudgetLimit(dailyBudgetCents, "update budget");
  writeGate("update budget");
  return apiCall(`/${objectId}`, "POST", { daily_budget: Number(dailyBudgetCents) }, {}, { dryRun });
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

async function getReachEstimate({ targetingSpec } = {}) {
  if (!targetingSpec || typeof targetingSpec !== "object") throw new Error("targetingSpec must be an object");
  return apiCall(`/${ACCOUNT_ID}/reachestimate`, "GET", null, { targeting_spec: targetingSpec });
}

// ── A/B Experiments ──────────────────────────────────────────────

async function listExperiments(fields = "id,name,type,start_time,end_time,created_time") {
  return apiCall(`/${ACCOUNT_ID}/ad_studies`, "GET", null, { fields, limit: 100 });
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
  return apiCall(`/${experimentId}/cells`, "GET", null, { fields, limit: 100 });
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
  return apiCall(`/${ACCOUNT_ID}/adrules_library`, "GET", null, { fields, limit: 100 });
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
  return apiCall(`/${pageId}/leadgen_forms`, "GET", null, { fields, limit: 100 });
}

async function getFormLeads(formId, fields = LEAD_LIST) {
  return apiCall(`/${formId}/leads`, "GET", null, { fields, limit: 100 });
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
  return apiCall(`/${ACCOUNT_ID}/insights`, "GET", null, params);
}

async function getCampaignInsights(campaignId, timeRange = "last_30d", breakdowns = null) {
  const params = {
    fields: "campaign_name,spend,impressions,reach,clicks,ctr,cpc,cpm,actions,cost_per_action_type,frequency,purchase_roas",
    date_preset: timeRange,
  };
  if (breakdowns) params.breakdowns = breakdowns;
  return apiCall(`/${campaignId}/insights`, "GET", null, params);
}

async function getAdSetInsights(adSetId, timeRange = "last_30d", breakdowns = null) {
  const params = {
    fields: "adset_name,spend,impressions,reach,clicks,ctr,cpc,cpm,actions,cost_per_action_type",
    date_preset: timeRange,
  };
  if (breakdowns) params.breakdowns = breakdowns;
  return apiCall(`/${adSetId}/insights`, "GET", null, params);
}

async function getAdInsights(adId, timeRange = "last_30d", breakdowns = null) {
  const params = {
    fields: "ad_name,spend,impressions,reach,clicks,ctr,cpc,cpm,actions,cost_per_action_type",
    date_preset: timeRange,
  };
  if (breakdowns) params.breakdowns = breakdowns;
  return apiCall(`/${adId}/insights`, "GET", null, params);
}

async function createAsyncReport({ objectId, fields, breakdowns, timeRange = "last_30d", level } = {}) {
  if (!objectId) throw new Error("objectId is required for an async insights report");
  const body = {
    async: true,
    fields: fields || "spend,impressions,reach,clicks,ctr,cpc,cpm,actions",
  };
  if (breakdowns) body.breakdowns = breakdowns;
  if (level) body.level = level;
  if (typeof timeRange === "object") body.time_range = timeRange;
  else body.date_preset = timeRange;
  return apiCall(`/${objectId}/insights`, "POST", body);
}

async function getAsyncReportStatus(reportRunId) {
  const report = await apiCall(`/${reportRunId}`, "GET", null, { fields: "id,async_status,async_percent_completion,date_start,date_stop" });
  if (report.async_status !== "Job Completed") return report;
  const insights = await apiCall(`/${reportRunId}/insights`, "GET");
  return { ...report, insights };
}

// ── Audiences ────────────────────────────────────────────────────

async function listCustomAudiences(fields = "id,name,approximate_count,subtype,time_created") {
  return apiCall(`/${ACCOUNT_ID}/customaudiences`, "GET", null, { fields, limit: 100 });
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
  return apiCall(`/${ACCOUNT_ID}/adspixels`, "GET", null, { fields });
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
  listAds, createAdCreative, createAd,
  uploadAdImage, listAdImages,
  updateBudget,
  searchTargeting, searchLocations, getReachEstimate,
  listExperiments, createExperiment, getExperiment, getExperimentResults,
  listRules, getRule, createRule, updateRule, deleteRule,
  LEADFORM_LIST, LEAD_LIST, listLeadForms, getFormLeads, getLead,
  getAccountInsights, getCampaignInsights, getAdSetInsights, getAdInsights,
  createAsyncReport, getAsyncReportStatus,
  listCustomAudiences, createCustomAudience, createLookalikeAudience,
  listPixels, getPixelStats,
  getAccountInfo,
};
