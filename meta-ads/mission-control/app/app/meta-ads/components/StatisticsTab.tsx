"use client";

// KPI tiles with period-over-period change, one trend chart per measure, and
// the campaign / ad set / ad table.

import type { Ads, Metric, Overview, Section } from "./types";
import { isEmpty, isFailure } from "./types";
import { changeLabel, formatValue } from "./format";
import { AdsTable } from "./AdsTable";
import { TrendChart } from "./TrendChart";
import { InlineError, Notice, Panel, cx } from "./ui";

function KpiTile({ metric, currency }: { metric: Metric; currency: string }) {
  const change = changeLabel(metric.changePct);
  const tone = metric.direction === "better" ? "text-emerald-300" : metric.direction === "worse" ? "text-dark-danger" : "text-dark-muted";
  return (
    <div className="rounded-lg border border-dark-border bg-dark-panel p-4">
      <div className="text-sm leading-5 text-dark-muted">{metric.label}</div>
      <div className="mt-1 break-words text-2xl font-semibold leading-8 text-dark-text tnum">{formatValue(metric.value, metric.format, currency)}</div>
      <div className={cx("mt-1 text-sm leading-5 tnum", tone)}>
        {change ? (
          <>
            <span className="font-medium">{change}</span>
            <span className="text-dark-muted"> vs {formatValue(metric.previous, metric.format, currency)} before</span>
          </>
        ) : (
          <span className="text-dark-muted">{metric.previous === null ? "No earlier period to compare" : "No change"}</span>
        )}
      </div>
      {metric.note && <div className="mt-1 text-sm leading-5 text-[color:var(--color-text-3)]">{metric.note}</div>}
    </div>
  );
}

export function StatisticsTab({ overview, ads, onRetry }: { overview: Section<Overview> | null; ads: Section<Ads> | null; onRetry: () => void }) {
  if (!overview || !ads) return null;
  if (isFailure(overview)) return <InlineError message={overview.error} onRetry={onRetry} />;
  if (isEmpty(overview)) return <Notice>{overview.message}</Notice>;
  const currency = overview.account.currency;
  const resultMetric = overview.metrics.find((metric) => metric.key === "results");
  return (
    <div className="space-y-4">
      {overview.period.note && <Notice tone="warn">{overview.period.note}</Notice>}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
        {overview.metrics.map((metric) => <KpiTile key={metric.key} metric={metric} currency={currency} />)}
      </div>
      {overview.resultsByType.length > 1 && (
        <Panel title="Everything Meta counted" aside={overview.period.label}>
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {overview.resultsByType.map((row) => (
              <li key={row.key} className="rounded-md bg-dark-panel2/70 px-3 py-2 text-sm">
                <div className="text-dark-muted">{row.label}</div>
                <div className="font-semibold text-dark-text tnum">{formatValue(row.count, "integer", currency)} <span className="font-normal text-dark-muted">at {formatValue(row.costPer, "currency", currency)} each</span></div>
              </li>
            ))}
          </ul>
        </Panel>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel>
          <TrendChart points={overview.trend} measure="spend" currency={currency} title="Spent per day" />
        </Panel>
        <Panel>
          <TrendChart points={overview.trend} measure="results" currency={currency} title={`${resultMetric?.label || "Results"} per day`} />
        </Panel>
      </div>
      <Panel title="Campaigns, ad sets and ads">
        {isFailure(ads) ? (
          <InlineError message={ads.error} onRetry={onRetry} />
        ) : isEmpty(ads) ? (
          <Notice>{ads.message}</Notice>
        ) : (
          <AdsTable rows={ads.rows} currency={ads.currency} windowLabel={ads.window.label.toLowerCase()} resultLabel={resultMetric?.label || "Results"} />
        )}
      </Panel>
    </div>
  );
}
