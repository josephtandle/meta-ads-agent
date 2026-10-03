"use client";

// The owner-language weekly summary: one headline, then each sentence with the
// numbers that back it. Printable (the Print button opens the browser's print
// dialog; the print stylesheet below hides everything but this panel).

import { Printer } from "lucide-react";
import type { Section, Sentence, Summary } from "./types";
import { isEmpty, isFailure } from "./types";
import { formatValue } from "./format";
import { Button, InlineError, Notice, cx } from "./ui";

const SENTENCE_TITLES: Record<string, string> = {
  spent: "What you spent",
  got: "What you got",
  cost: "What each result cost",
  sales: "Sales value",
  changed: "What changed",
  working: "What is working",
  wasting: "What is wasting money",
  next: "What to do next",
  cap: "Budget cap",
  refreshed: "Data freshness",
  writes: "Live writes",
};

const NUMBER_FORMATS: Record<string, string> = {
  spend: "currency", previousSpend: "currency", costPerResult: "currency", previousCostPerResult: "currency", purchaseValue: "currency", cpm: "currency", previousCpm: "currency", total: "currency",
  changePct: "percent", ctr: "percent", previousCtr: "percent", pctOfCap: "percent",
  results: "integer", previousResults: "integer", impressions: "integer", clicks: "integer", activeCampaigns: "integer", campaigns: "integer",
  roas: "multiple",
  capCents: "cents", highestDailyBudgetCents: "cents",
};

const NUMBER_LABELS: Record<string, string> = {
  spend: "Spent", previousSpend: "Spent before", changePct: "Change", results: "Results", previousResults: "Results before", impressions: "Times shown", clicks: "Clicks",
  costPerResult: "Cost per result", previousCostPerResult: "Cost before", purchaseValue: "Sales value", roas: "ROAS", ctr: "Click rate", previousCtr: "Click rate before", cpm: "CPM", previousCpm: "CPM before",
  activeCampaigns: "Active campaigns", campaigns: "Campaigns", total: "Total", capCents: "Cap per day", highestDailyBudgetCents: "Highest daily budget", pctOfCap: "Of the cap",
  ageHours: "Hours since refresh",
};

function backingNumbers(sentence: Sentence, currency: string): { key: string; label: string; value: string }[] {
  const out: { key: string; label: string; value: string }[] = [];
  for (const [key, raw] of Object.entries(sentence.numbers)) {
    if (raw === null || raw === undefined || typeof raw === "object" || typeof raw === "boolean" || key === "ageHours" || key === "source") continue;
    const format = NUMBER_FORMATS[key];
    if (!format && typeof raw !== "number") continue;
    const value = format === "cents" && typeof raw === "number" ? formatValue(raw / 100, "currency", currency) : formatValue(raw, format || "decimal", currency);
    out.push({ key, label: NUMBER_LABELS[key] || key, value });
  }
  return out;
}

export function SummaryTab({ data, onRetry }: { data: Section<Summary> | null; onRetry: () => void }) {
  if (!data) return null;
  if (isFailure(data)) return <InlineError message={data.error} onRetry={onRetry} />;
  if (isEmpty(data)) return <Notice>{data.message}</Notice>;
  const currency = data.currency;
  return (
    <div id="meta-ads-summary" className="space-y-4">
      <section className="rounded-xl border border-dark-border bg-dark-panel p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium uppercase tracking-wide text-dark-muted">{data.period.label}{data.period.since && data.period.until ? ` · ${data.period.since} to ${data.period.until}` : ""}</p>
            <h2 className="mt-1 text-xl font-semibold leading-7 text-dark-text sm:text-2xl">{data.headline}</h2>
          </div>
          <Button onClick={() => window.print()} icon={<Printer size={16} aria-hidden="true" />} className="print:hidden">Print</Button>
        </div>
      </section>
      <ol className="space-y-3">
        {data.sentences.map((sentence) => {
          const numbers = backingNumbers(sentence, currency);
          const tone = sentence.key === "wasting" && /Wasting money:/.test(sentence.text) ? "border-l-[color:var(--color-danger)]" : sentence.key === "working" && /^Working:/.test(sentence.text) ? "border-l-emerald-400" : sentence.key === "next" ? "border-l-[color:var(--color-purple)]" : "border-l-dark-border";
          return (
            <li key={sentence.key} className={cx("rounded-lg border border-dark-border border-l-4 bg-dark-panel p-4", tone)}>
              <h3 className="text-sm font-medium uppercase tracking-wide text-dark-muted">{SENTENCE_TITLES[sentence.key] || sentence.key}</h3>
              <p className="mt-1 text-base leading-7 text-dark-text">{sentence.text}</p>
              {numbers.length > 0 && (
                <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-dark-muted tnum">
                  {numbers.map((item) => (
                    <div key={item.key} className="flex gap-1.5">
                      <dt>{item.label}</dt>
                      <dd className="font-medium text-dark-text">{item.value}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </li>
          );
        })}
      </ol>
      <p className="text-sm text-dark-muted">Generated {new Date(data.generatedAt).toLocaleString("en-US")} from the agent's last refresh. Every number comes from your ad account's cached insights; nothing here changes the account.</p>
    </div>
  );
}
