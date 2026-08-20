function readArg(input, names, fallback = undefined) {
  const args = input && typeof input === "object" ? input.args || {} : {};
  const keys = Array.isArray(names) ? names : [names];
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(args, key)) {
      return args[key];
    }
  }
  return fallback;
}

function requireTextArg(input, names, label) {
  const value = readArg(input, names);
  if (value === undefined || value === null || String(value).trim() === "") {
    throw new Error(`Missing required argument: ${label}`);
  }
  return String(value).trim();
}

function normalizeTimeRange(input, fallback = "last_30d") {
  const value = readArg(input, ["timeRange", "range", "datePreset"], fallback);
  const normalized = String(value || fallback).trim();
  return normalized || fallback;
}

function checkDailyBudgetLimit(dailyBudgetCents, action) {
  const budget = Number(dailyBudgetCents);
  if (!Number.isFinite(budget) || budget <= 0) {
    throw new Error(`${action}: daily_budget must be positive`);
  }
  const limit = process.env.META_ADS_MAX_DAILY_BUDGET_CENTS;
  if (!limit) return;
  if (budget > Number(limit)) {
    throw new Error(`${action}: budget ${budget} exceeds META_ADS_MAX_DAILY_BUDGET_CENTS=${limit}`);
  }
}

function writeGate(action) {
  if (process.env.META_ADS_WRITES_ENABLED !== "true") {
    throw new Error("writes disabled: set META_ADS_WRITES_ENABLED=true");
  }
}

function extractData(result) {
  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.data)) return result.data;
  return [];
}

function firstDataRow(result) {
  return extractData(result)[0] || null;
}

function formatCurrency(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "N/A";
  return `$${number.toFixed(2)}`;
}

function formatCurrencyFromCents(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "N/A";
  return `$${(number / 100).toFixed(2)}`;
}

function formatInteger(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return value === null || value === undefined ? "N/A" : String(value);
  return Math.trunc(number).toLocaleString();
}

function formatPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return value === null || value === undefined ? "N/A" : String(value);
  return `${number.toFixed(2)}%`;
}

function formatDecimal(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return value === null || value === undefined ? "N/A" : String(value);
  return number.toFixed(2);
}

function summarizeAccount(account = {}) {
  return {
    id: account.id || null,
    name: account.name || null,
    status: account.account_status || account.status || null,
    currency: account.currency || null,
    timezoneName: account.timezone_name || null,
    amountSpentCents: account.amount_spent ?? null,
    amountSpent: account.amount_spent !== undefined && account.amount_spent !== null ? formatCurrencyFromCents(account.amount_spent) : null,
    balanceCents: account.balance ?? null,
    balance: account.balance !== undefined && account.balance !== null ? formatCurrencyFromCents(account.balance) : null,
    spendCapCents: account.spend_cap ?? null,
    spendCap: account.spend_cap !== undefined && account.spend_cap !== null ? formatCurrencyFromCents(account.spend_cap) : null,
    business: account.business || null,
  };
}

function summarizeCampaign(campaign = {}) {
  return {
    id: campaign.id || null,
    name: campaign.name || null,
    status: campaign.status || null,
    objective: campaign.objective || null,
    dailyBudgetCents: campaign.daily_budget ?? null,
    dailyBudget: campaign.daily_budget !== undefined && campaign.daily_budget !== null ? formatCurrencyFromCents(campaign.daily_budget) : null,
    lifetimeBudgetCents: campaign.lifetime_budget ?? null,
    lifetimeBudget: campaign.lifetime_budget !== undefined && campaign.lifetime_budget !== null ? formatCurrencyFromCents(campaign.lifetime_budget) : null,
    startTime: campaign.start_time || null,
    stopTime: campaign.stop_time || null,
    createdTime: campaign.created_time || null,
  };
}

function summarizeAdSet(adSet = {}) {
  return {
    id: adSet.id || null,
    name: adSet.name || null,
    status: adSet.status || null,
    dailyBudgetCents: adSet.daily_budget ?? null,
    dailyBudget: adSet.daily_budget !== undefined && adSet.daily_budget !== null ? formatCurrencyFromCents(adSet.daily_budget) : null,
    lifetimeBudgetCents: adSet.lifetime_budget ?? null,
    lifetimeBudget: adSet.lifetime_budget !== undefined && adSet.lifetime_budget !== null ? formatCurrencyFromCents(adSet.lifetime_budget) : null,
    targeting: adSet.targeting || null,
    optimizationGoal: adSet.optimization_goal || null,
    bidStrategy: adSet.bid_strategy || null,
    startTime: adSet.start_time || null,
    endTime: adSet.end_time || null,
  };
}

function summarizeAd(ad = {}) {
  return {
    id: ad.id || null,
    name: ad.name || null,
    status: ad.status || null,
    creativeId: ad.creative?.id || ad.creative?.creative_id || null,
    creative: ad.creative
      ? {
          id: ad.creative.id || null,
          title: ad.creative.title || null,
          body: ad.creative.body || null,
          imageUrl: ad.creative.image_url || null,
          thumbnailUrl: ad.creative.thumbnail_url || null,
        }
      : null,
  };
}

function summarizeInsight(row = {}) {
  return {
    name: row.campaign_name || row.adset_name || row.ad_name || null,
    spend: row.spend ?? null,
    impressions: row.impressions ?? null,
    reach: row.reach ?? null,
    clicks: row.clicks ?? null,
    ctr: row.ctr ?? null,
    cpc: row.cpc ?? null,
    cpm: row.cpm ?? null,
    frequency: row.frequency ?? null,
    actions: row.actions ?? null,
    costPerActionType: row.cost_per_action_type ?? null,
    purchaseRoas: row.purchase_roas ?? null,
  };
}

function buildListResponse({ title, emptyMessage, items, renderRow, metadataKey }) {
  if (!items.length) {
    return {
      status: "skipped",
      reply: emptyMessage,
      metadata: {
        [metadataKey]: [],
      },
    };
  }

  const lines = [`${title} (${items.length}):`];
  for (const item of items.slice(0, 10)) {
    lines.push(`- ${renderRow(item)}`);
  }

  return {
    status: "ok",
    reply: lines.join("\n"),
    metadata: {
      [metadataKey]: items,
    },
  };
}

module.exports = {
  buildListResponse,
  checkDailyBudgetLimit,
  extractData,
  firstDataRow,
  formatCurrency,
  formatCurrencyFromCents,
  formatDecimal,
  formatInteger,
  formatPercent,
  normalizeTimeRange,
  readArg,
  requireTextArg,
  summarizeAccount,
  summarizeAd,
  summarizeAdSet,
  summarizeCampaign,
  summarizeInsight,
  writeGate,
};
