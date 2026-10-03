// Shapes returned by /api/meta-ads/* (the agent's src/dashboard-data.js).

export type PeriodKey = "7d" | "14d" | "30d" | "month";

export interface Account { name: string | null; currency: string; timezone: string | null; status: string | null; spendCapCents: number | null; balanceCents: number | null }

export interface Period { key: PeriodKey; label: string; since: string | null; until: string | null; days: number | null; source: "daily" | "cached_total" | "none"; comparison: { since: string; until: string; days: number } | null; note: string | null }

export interface Metric { key: string; label: string; value: number | null; previous: number | null; changePct: number | null; direction: "better" | "worse" | "flat" | null; format: string; note?: string | null; resultType?: string | null }

export interface ResultType { key: string; label: string; singular: string; count: number; costPer: number | null; previous: number | null; changePct: number | null }

export interface TrendPoint { date: string; spend: number | null; results: number; clicks: number | null; impressions: number | null }

export interface EmptyState { ok: true; empty: true; section: string; message: string; credentialsConfigured: boolean; missing: string[]; account: Account; lastSync: string | null }

export interface Overview { ok: true; empty: false; account: Account; period: Period; metrics: Metric[]; resultsByType: ResultType[]; trend: TrendPoint[]; campaigns: { total: number; active: number; paused: number }; lastSync: string | null }

export interface AdRow {
  level: "campaign" | "adset" | "ad";
  id: string;
  name: string;
  status: string;
  rawStatus: string | null;
  active: boolean;
  objective: string | null;
  optimizationGoal: string | null;
  campaignId: string | null;
  campaignName: string | null;
  adsetId: string | null;
  adsetName: string | null;
  budget: { type: "daily" | "lifetime" | null; cents: number | null };
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number | null;
  cpm: number | null;
  frequency: number | null;
  results: number;
  resultType: string | null;
  resultLabel: string;
  costPerResult: number | null;
  resultsByType: ResultType[];
  purchaseValue: number | null;
  roas: number | null;
  lastChange: string | null;
  hasInsights: boolean;
}

export interface Ads { ok: true; empty: false; account: Account; currency: string; window: { since: string | null; until: string | null; label: string }; counts: { campaigns: number; adsets: number; ads: number; activeCampaigns: number }; rows: AdRow[]; lastSync: string | null }

export interface Evidence { label: string; value: number | string | null; format: string }

export interface Card {
  id: string;
  group: "scale" | "fix" | "stop" | "watch";
  groupLabel: string;
  title: string;
  what: string;
  why: string;
  evidence: Evidence[];
  expectedEffect: string;
  risk: "low" | "medium" | "high";
  riskNote: string;
  nextStep: string;
  command: string | null;
  recipe: string | null;
  source: "planner" | "rules";
  objectId: string | null;
  level: string | null;
  objectName: string | null;
}

export interface Group { key: Card["group"]; label: string; blurb: string; cards: Card[] }

export interface BudgetCap { limitCents: number | null; source: "default" | "env" | "invalid" }

export interface Improvements { ok: true; empty: false; account: Account; currency: string; window: string; note: string | null; writesEnabled: boolean; budgetCap: BudgetCap; groups: Group[]; total: number; contract: string; plannerStatus: string | null; plannerWarnings: string[]; lastSync: string | null }

export interface Sentence { key: string; text: string; numbers: Record<string, unknown> }

export interface Summary { ok: true; empty: false; account: Account; currency: string; period: Period; headline: string; sentences: Sentence[]; controls: { writesEnabled: boolean; budgetCap: BudgetCap; highestDailyBudgetCents: number; lastSync: string | null; stale: boolean }; generatedAt: string }

export interface Freshness {
  ok: true;
  lastSync: string | null;
  ageHours: number | null;
  stale: boolean;
  syncErrors: Record<string, string> | null;
  hasData: boolean;
  hasDailySeries: boolean;
  hasLevelInsights: boolean;
  credentialsConfigured: boolean;
  missing: string[];
  required: string[];
  refreshPossible: boolean;
  refreshBlocker: string | null;
  writesEnabled: boolean;
  budgetCap: BudgetCap;
  account: Account;
  files: Record<string, boolean>;
  envFile: string;
  setupDoc: string;
  agentVersion: string | null;
}

export interface Failure { ok: false; error: string; agent?: { dir: string; installed: boolean; current: boolean } }

export type Section<T> = T | EmptyState | Failure;

export function isFailure(value: unknown): value is Failure {
  return Boolean(value) && (value as Failure).ok === false;
}

export function isEmpty(value: unknown): value is EmptyState {
  return Boolean(value) && (value as EmptyState).empty === true;
}
