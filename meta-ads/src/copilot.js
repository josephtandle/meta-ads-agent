const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "../data");

const OBJECTIVE_ALIASES = {
  bookings: "OUTCOME_LEADS",
  calls: "OUTCOME_LEADS",
  conversions: "OUTCOME_SALES",
  leads: "OUTCOME_LEADS",
  messages: "OUTCOME_ENGAGEMENT",
  sales: "OUTCOME_SALES",
  traffic: "OUTCOME_TRAFFIC",
  video: "OUTCOME_ENGAGEMENT",
};

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function slugify(value) {
  return String(value || "campaign")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "campaign";
}

function normalizeObjective(input = {}) {
  const raw = String(input.objective || input.goal || "leads").toLowerCase();
  return OBJECTIVE_ALIASES[raw] || input.objective || "OUTCOME_LEADS";
}

function buildCampaignDraft(input = {}) {
  const now = new Date().toISOString();
  const offer = input.offer || input.name || "Meta Ads Test Campaign";
  const audience = input.audience || "warm audience and lookalike prospects";
  const dailyBudgetUsd = Number(input.dailyBudgetUsd || input.daily_budget_usd || 20);

  return {
    mode: "draft_only",
    approvalRequired: true,
    createdAt: now,
    source: "meta-ads-agent/copilot-v0",
    status: "PAUSED",
    campaign: {
      name: input.campaignName || `${offer} - AI-assisted launch`,
      objective: normalizeObjective(input),
      status: "PAUSED",
      special_ad_categories: input.specialAdCategories || [],
    },
    adSet: {
      name: input.adSetName || `${audience} - test ad set`,
      status: "PAUSED",
      daily_budget: Math.round(dailyBudgetUsd * 100),
      billing_event: input.billingEvent || "IMPRESSIONS",
      optimization_goal: input.optimizationGoal || "LEAD_GENERATION",
      targeting: input.targeting || {
        geo_locations: { countries: input.countries || ["US"] },
        age_min: input.ageMin || 25,
        age_max: input.ageMax || 55,
      },
      placements: input.placements || ["facebook_feed", "instagram_reels", "instagram_stories"],
    },
    creativeBrief: {
      offer,
      audience,
      promise: input.promise || input.goal || "generate qualified interest",
      angle: input.angle || "AI-assisted, practical, outcome-focused",
      primaryText: input.primaryText || "",
      headline: input.headline || offer,
      callToAction: input.callToAction || "LEARN_MORE",
      destinationUrl: input.link || input.destinationUrl || "",
    },
    checklist: [
      "Confirm pixel/conversion event before live launch.",
      "Confirm landing page matches the ad promise.",
      "Review creative and copy for compliance.",
      "Create campaign/ad set/ad as PAUSED first.",
      "Get the account owner’s approval before activation or budget increase.",
    ],
  };
}

function saveCampaignDraft(draft) {
  ensureDataDir();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const name = slugify(draft.campaign && draft.campaign.name);
  const filePath = path.join(DATA_DIR, `draft-${stamp}-${name}.json`);
  fs.writeFileSync(filePath, JSON.stringify(draft, null, 2));
  return filePath;
}

module.exports = {
  buildCampaignDraft,
  saveCampaignDraft,
};
