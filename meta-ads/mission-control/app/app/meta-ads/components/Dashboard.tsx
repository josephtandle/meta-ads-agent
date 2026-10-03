"use client";

// The Meta Ads owner dashboard: one screen with Summary, Statistics and
// Improvements tabs. A thin client over /api/meta-ads/*: every number and every
// sentence comes from the agent's read-only data layer. Refresh runs the
// agent's own sync; nothing on this screen can change an ad account.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Megaphone, RefreshCw } from "lucide-react";
import type { Ads, Failure, Freshness, Improvements, Overview, PeriodKey, Section, Summary } from "./types";
import { isFailure } from "./types";
import { dateTime, money, relativeTime } from "./format";
import { ImprovementsTab } from "./ImprovementsTab";
import { SetupState } from "./SetupState";
import { StatisticsTab } from "./StatisticsTab";
import { SummaryTab } from "./SummaryTab";
import { Button, InlineError, Notice, Pill, Spinner, Tabs, cx } from "./ui";

type Tab = "summary" | "statistics" | "improvements";
const TABS: { key: Tab; label: string }[] = [
  { key: "summary", label: "Summary" },
  { key: "statistics", label: "Statistics" },
  { key: "improvements", label: "Improvements" },
];
const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: "7d", label: "7 days" },
  { key: "14d", label: "14 days" },
  { key: "30d", label: "30 days" },
  { key: "month", label: "This month" },
];
const API = "/api/meta-ads";

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const body = (await response.json().catch(() => null)) as T | null;
  if (body) return body;
  return { ok: false, error: `The server answered ${response.status} without a readable body.` } as unknown as T;
}

export default function Dashboard() {
  const [tab, setTab] = useState<Tab>("summary");
  const [period, setPeriod] = useState<PeriodKey>("7d");
  const [freshness, setFreshness] = useState<Freshness | Failure | null>(null);
  const [overview, setOverview] = useState<Section<Overview> | null>(null);
  const [ads, setAds] = useState<Section<Ads> | null>(null);
  const [improvements, setImprovements] = useState<Section<Improvements> | null>(null);
  const [summary, setSummary] = useState<Section<Summary> | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMessage, setRefreshMessage] = useState<{ tone: "info" | "warn"; text: string } | null>(null);

  const load = useCallback(async (selected: PeriodKey) => {
    setLoading(true);
    const [fresh, over, summ, adRows, impr] = await Promise.all([
      getJson<Freshness | Failure>(`${API}/freshness`),
      getJson<Section<Overview>>(`${API}/overview?period=${selected}`),
      getJson<Section<Summary>>(`${API}/summary?period=${selected}`),
      getJson<Section<Ads>>(`${API}/ads`),
      getJson<Section<Improvements>>(`${API}/improvements`),
    ]);
    setFreshness(fresh);
    setOverview(over);
    setSummary(summ);
    setAds(adRows);
    setImprovements(impr);
    setLoading(false);
  }, []);

  // Deep links: /app/meta-ads?tab=statistics&period=30d
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const wantedTab = params.get("tab");
    const wantedPeriod = params.get("period");
    if (wantedTab && TABS.some((item) => item.key === wantedTab)) setTab(wantedTab as Tab);
    if (wantedPeriod && PERIODS.some((item) => item.key === wantedPeriod)) setPeriod(wantedPeriod as PeriodKey);
  }, []);

  useEffect(() => { void load(period); }, [load, period]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setRefreshMessage(null);
    const result = await getJson<{ ok: boolean; ran?: boolean; error?: string | null; output?: string; syncErrors?: Record<string, string> | null }>(`${API}/refresh`, { method: "POST" });
    if (result.ok) {
      setRefreshMessage({ tone: "info", text: "Refreshed. The numbers below are current." });
    } else {
      const failed = result.syncErrors ? Object.keys(result.syncErrors) : [];
      setRefreshMessage({ tone: "warn", text: result.error || (failed.length ? `Refreshed most data; these sources did not sync: ${failed.join(", ")}.` : "Refresh did not complete.") });
    }
    await load(period);
    setRefreshing(false);
  }, [load, period]);

  const fresh = freshness && !isFailure(freshness) ? freshness : null;
  const account = fresh?.account || null;
  const currency = account?.currency || "USD";
  const agentMissing = freshness && isFailure(freshness);
  const needsSetup = Boolean(fresh && !fresh.credentialsConfigured && !fresh.hasData);
  const periodNote = useMemo(() => (overview && !isFailure(overview) && !("empty" in overview && overview.empty) ? overview.period : null), [overview]);

  return (
    <div className="mx-auto w-full max-w-7xl space-y-4 print:max-w-none">
      <style>{`@media print { body * { visibility: hidden; } #meta-ads-summary, #meta-ads-summary * { visibility: visible; } #meta-ads-summary { position: absolute; left: 0; top: 0; width: 100%; } }`}</style>
      <header className="flex flex-col gap-3 print:hidden">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium uppercase tracking-[0.18em] text-cm-purple">Meta Ads</p>
            <h1 className="mt-1 flex items-center gap-2 text-2xl font-semibold tracking-tight text-dark-text">
              <Megaphone className="h-6 w-6 shrink-0" aria-hidden="true" />
              <span className="truncate">{account?.name ? `${account.name}` : "Your ad account"}</span>
            </h1>
            <p className="mt-1 text-sm text-dark-muted">
              {fresh?.lastSync ? <>Last refreshed {relativeTime(fresh.lastSync)} <span className="text-[color:var(--color-text-3)]">({dateTime(fresh.lastSync)})</span></> : "Not refreshed yet"}
              {fresh?.stale && fresh.lastSync ? <span className="text-dark-warn"> · more than a day old</span> : null}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {fresh && (
              <>
                <Pill tone={fresh.writesEnabled ? "warn" : "good"} title={fresh.writesEnabled ? "META_ADS_WRITES_ENABLED=true: live commands can change the account (each still asks for a typed confirmation)." : "The agent can only read and preview changes."}>
                  Writes {fresh.writesEnabled ? "on" : "off"}
                </Pill>
                <Pill tone={fresh.budgetCap.limitCents === null ? "bad" : "neutral"} title="The agent refuses any daily budget above this (META_ADS_MAX_DAILY_BUDGET_CENTS).">
                  Budget cap {fresh.budgetCap.limitCents === null ? "invalid" : `${money(fresh.budgetCap.limitCents / 100, currency)} / day`}
                </Pill>
              </>
            )}
            <Button variant="primary" onClick={refresh} busy={refreshing} disabled={!fresh || !fresh.refreshPossible} title={fresh && !fresh.refreshPossible ? fresh.refreshBlocker || "Add credentials first" : "Pull today's numbers from Meta (read-only)"} icon={<RefreshCw size={16} aria-hidden="true" />}>
              {refreshing ? "Refreshing" : "Refresh"}
            </Button>
          </div>
        </div>
        {!needsSetup && !agentMissing && (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <Tabs value={tab} onChange={setTab} items={TABS} />
            <div role="group" aria-label="Period" className="flex gap-1 overflow-x-auto rounded-lg border border-dark-border bg-dark-panel2 p-1">
              {PERIODS.map((item) => (
                <button key={item.key} type="button" aria-pressed={period === item.key} onClick={() => setPeriod(item.key)} className={cx("min-h-9 flex-1 whitespace-nowrap rounded-md px-3 text-sm font-medium", period === item.key ? "bg-dark-panel text-dark-text shadow-sm" : "text-dark-muted hover:text-dark-text")}>
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        )}
        {periodNote && periodNote.since && periodNote.until && (
          <p className="text-sm text-dark-muted">
            Showing {periodNote.since} to {periodNote.until}{periodNote.comparison ? `, compared with ${periodNote.comparison.since} to ${periodNote.comparison.until}` : ""}.
          </p>
        )}
        {refreshMessage && <Notice tone={refreshMessage.tone}>{refreshMessage.text}</Notice>}
        {fresh?.syncErrors && !refreshMessage && (
          <Notice tone="warn">Some sources did not sync last time ({Object.keys(fresh.syncErrors).join(", ")}). The rest of the data is current.</Notice>
        )}
      </header>

      {loading && !freshness ? (
        <Spinner label="Loading your ad account" />
      ) : agentMissing && freshness && isFailure(freshness) ? (
        <InlineError message={freshness.error} onRetry={() => load(period)} />
      ) : needsSetup && fresh ? (
        <SetupState freshness={fresh} />
      ) : (
        <div className={cx(loading && "opacity-60 transition-opacity")} aria-busy={loading}>
          {tab === "summary" && <SummaryTab data={summary} onRetry={() => load(period)} />}
          {tab === "statistics" && <StatisticsTab overview={overview} ads={ads} onRetry={() => load(period)} />}
          {tab === "improvements" && <ImprovementsTab data={improvements} onRetry={() => load(period)} />}
        </div>
      )}
    </div>
  );
}
