// Offline Graph API stand-in, loaded into CLI child processes via
// NODE_OPTIONS=--require. It answers with realistic Graph JSON whose paging
// links and error messages deliberately carry the fake credentials from the
// environment, so a test can prove the CLI never prints them. Every request
// is appended to META_ADS_STUB_LOG (one JSON line) when that is set.
"use strict";

const fs = require("fs");

const TOKEN = process.env.META_ADS_ACCESS_TOKEN;
const SECRET = process.env.META_ADS_APP_SECRET;
const ACCOUNT = process.env.META_ADS_ACCOUNT_ID || "act_123";
const APP_ID = process.env.META_ADS_APP_ID || "123456789";
const BASE = "https://graph.facebook.com/v25.0";

function pagingUrl(resource, cursorName, cursor) {
  return `${BASE}${resource}?access_token=${encodeURIComponent(TOKEN)}&appsecret_proof=${SECRET}&fields=id%2Cname&limit=100&${cursorName}=${cursor}`;
}

function json(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body,
  };
}

function collection(resource, rows, url) {
  const after = url.searchParams.get("after");
  if (after) {
    return {
      data: rows.slice(1),
      paging: {
        cursors: { before: "QVFIUmN1cnNvcjI", after: "QVFIUmN1cnNvcjM" },
        previous: pagingUrl(resource, "before", "QVFIUmN1cnNvcjI"),
      },
    };
  }
  return {
    data: rows.slice(0, 1),
    paging: {
      cursors: { before: "QVFIUmN1cnNvcjE", after: "QVFIUmN1cnNvcjI" },
      next: pagingUrl(resource, "after", "QVFIUmN1cnNvcjI"),
    },
  };
}

const campaigns = [
  { id: "c1", name: "Workshop Sept", status: "ACTIVE", objective: "OUTCOME_SALES", daily_budget: "2000", budget_remaining: "1200", bid_strategy: "LOWEST_COST_WITHOUT_CAP", created_time: "2026-09-01T00:00:00+0000" },
  { id: "c2", name: "Retargeting", status: "PAUSED", objective: "OUTCOME_LEADS", lifetime_budget: "50000", budget_remaining: "48000", created_time: "2026-09-02T00:00:00+0000" },
];
const adsets = [
  { id: "as1", name: "Cold AU", status: "ACTIVE", effective_status: "ACTIVE", campaign_id: "c1", daily_budget: "1500", lifetime_budget: "0", budget_remaining: "900", bid_strategy: "LOWEST_COST_WITHOUT_CAP", optimization_goal: "OFFSITE_CONVERSIONS", billing_event: "IMPRESSIONS" },
  { id: "as2", name: "Warm list", status: "PAUSED", effective_status: "PAUSED", campaign_id: "c2", daily_budget: "0", lifetime_budget: "50000", budget_remaining: "48000", bid_strategy: "COST_CAP", optimization_goal: "LINK_CLICKS" },
];
const ads = [
  { id: "ad1", name: "Hook A", status: "ACTIVE", campaign_id: "c1", creative: { id: "cr1", title: "Less busy work", body: "More sales", image_url: "https://scontent.example/img.jpg" } },
  { id: "ad2", name: "Hook B", status: "PAUSED", campaign_id: "c1", creative: { id: "cr2", title: "Second hook" } },
];
const insights = [
  { campaign_name: "Workshop Sept", spend: "123.45", impressions: "10000", reach: "8000", clicks: "250", ctr: "2.5", cpc: "0.49", cpm: "12.3", frequency: "1.25", date_start: "2026-09-01", date_stop: "2026-09-30" },
];

function errorBody(path, url) {
  return {
    error: {
      message: `Unsupported get request. Object with ID '${path.slice(1)}' does not exist (request ${url.toString()} appsecret_proof=${SECRET} token ${TOKEN})`,
      type: "GraphMethodException",
      code: 100,
      error_subcode: 33,
      fbtrace_id: "AbCdEfGh",
    },
  };
}

global.fetch = async (input, options = {}) => {
  const url = new URL(String(input));
  const method = (options.method || "GET").toUpperCase();
  const path = url.pathname.replace(/^\/v\d+\.\d+/, "");
  if (process.env.META_ADS_STUB_LOG) {
    const params = Object.fromEntries(url.searchParams.entries());
    delete params.access_token;
    fs.appendFileSync(process.env.META_ADS_STUB_LOG, `${JSON.stringify({ method, path, params, body: options.body ? JSON.parse(options.body) : null })}\n`);
  }

  if (method !== "GET") {
    // Write responses from Meta echo little, but an error-ish debug field with
    // the request URL is the kind of thing that leaks into an audit log.
    return json({ success: true, id: "123456", debug_request: url.toString() });
  }

  switch (path) {
    case `/${ACCOUNT}`:
      return json({ id: ACCOUNT, name: "Fake Business Account", account_status: 1, currency: "USD", timezone_name: "Asia/Makassar", amount_spent: "123456", balance: "5000", spend_cap: "0", business: { id: "9876", name: "Fake Business Co" } });
    case `/${APP_ID}`:
      return json({ id: APP_ID, name: "Fake Meta App" });
    case `/${ACCOUNT}/campaigns`:
      return json(collection(path, campaigns, url));
    case "/c1":
      return json({ ...campaigns[0], insights: { data: insights, paging: { cursors: { before: "A", after: "B" }, next: pagingUrl("/c1/insights", "after", "B") } } });
    case `/${ACCOUNT}/adsets`:
    case "/c1/adsets":
      return json(collection(path, adsets, url));
    case `/${ACCOUNT}/ads`:
    case "/as1/ads":
      return json(collection(path, ads, url));
    case `/${ACCOUNT}/insights`:
    case "/c1/insights":
      return json({ data: insights, paging: { cursors: { before: "A", after: "B" }, previous: pagingUrl(path, "before", "A") } });
    case "/search":
      return json({ data: [{ id: "6003", name: "Artificial intelligence", audience_size_lower_bound: 1000 }], paging: { cursors: { before: "A", after: "B" }, next: pagingUrl("/search", "after", "B") } });
    default:
      return json(errorBody(path, url), 400);
  }
};
