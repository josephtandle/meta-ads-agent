"use client";

// Every campaign, ad set and ad with its numbers: level switch, status filter,
// search, sortable columns. On narrow screens the table becomes a list of
// cards so the page never scrolls sideways.

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Search } from "lucide-react";
import type { AdRow } from "./types";
import { decimal, integer, money, percent, shortDate } from "./format";
import { cx, focusRing } from "./ui";

type Level = AdRow["level"];
type SortKey = "name" | "status" | "budget" | "spend" | "results" | "costPerResult" | "ctr" | "frequency" | "lastChange";
type StatusFilter = "all" | "active" | "paused";

const LEVELS: { key: Level; label: string }[] = [
  { key: "campaign", label: "Campaigns" },
  { key: "adset", label: "Ad sets" },
  { key: "ad", label: "Ads" },
];

const COLUMNS: { key: SortKey; label: string; align?: "right" }[] = [
  { key: "name", label: "Name" },
  { key: "status", label: "Status" },
  { key: "budget", label: "Budget", align: "right" },
  { key: "spend", label: "Spent", align: "right" },
  { key: "results", label: "Results", align: "right" },
  { key: "costPerResult", label: "Cost / result", align: "right" },
  { key: "ctr", label: "Click rate", align: "right" },
  { key: "frequency", label: "Frequency", align: "right" },
  { key: "lastChange", label: "Last change" },
];

function sortValue(row: AdRow, key: SortKey): number | string {
  switch (key) {
    case "name": return row.name.toLowerCase();
    case "status": return row.status.toLowerCase();
    case "budget": return row.budget.cents ?? -1;
    case "spend": return row.spend;
    case "results": return row.results;
    case "costPerResult": return row.costPerResult ?? Number.POSITIVE_INFINITY;
    case "ctr": return row.ctr ?? -1;
    case "frequency": return row.frequency ?? -1;
    case "lastChange": return row.lastChange || "";
    default: return "";
  }
}

function budgetLabel(row: AdRow, currency: string): string {
  if (!row.budget.cents) return "n/a";
  return `${money(row.budget.cents / 100, currency)}${row.budget.type === "daily" ? " / day" : " total"}`;
}

function StatusBadge({ row }: { row: AdRow }) {
  const tone = row.active ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300" : /issue|disapproved|billing/i.test(row.status) ? "border-dark-danger/40 bg-dark-danger/10 text-dark-danger" : "border-dark-border bg-dark-panel2 text-dark-muted";
  return <span className={cx("inline-flex min-h-6 items-center whitespace-nowrap rounded-full border px-2 text-sm leading-5", tone)}>{row.status}</span>;
}

export function AdsTable({ rows, currency, windowLabel, resultLabel }: { rows: AdRow[]; currency: string; windowLabel: string; resultLabel: string }) {
  const [level, setLevel] = useState<Level>("campaign");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "spend", dir: "desc" });

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = rows.filter((row) => row.level === level)
      .filter((row) => (status === "all" ? true : status === "active" ? row.active : !row.active))
      .filter((row) => !needle || [row.name, row.campaignName, row.adsetName, row.id].some((value) => (value || "").toLowerCase().includes(needle)));
    return filtered.sort((a, b) => {
      const av = sortValue(a, sort.key);
      const bv = sortValue(b, sort.key);
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sort.dir === "asc" ? cmp : -cmp;
    });
  }, [rows, level, status, query, sort]);

  const toggleSort = (key: SortKey) => setSort((current) => (current.key === key ? { key, dir: current.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "name" || key === "status" ? "asc" : "desc" }));
  const counts = { campaign: rows.filter((row) => row.level === "campaign").length, adset: rows.filter((row) => row.level === "adset").length, ad: rows.filter((row) => row.level === "ad").length };

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 md:flex-row md:flex-wrap md:items-center">
        <div role="tablist" aria-label="Level" className="flex gap-1 rounded-lg border border-dark-border bg-dark-panel2 p-1">
          {LEVELS.map((item) => (
            <button key={item.key} role="tab" type="button" aria-selected={level === item.key} onClick={() => setLevel(item.key)} className={cx("min-h-9 flex-1 whitespace-nowrap rounded-md px-3 text-sm font-medium", level === item.key ? "bg-dark-panel text-dark-text shadow-sm" : "text-dark-muted hover:text-dark-text", focusRing)}>
              {item.label} <span className="text-dark-muted tnum">{counts[item.key]}</span>
            </button>
          ))}
        </div>
        <label className="flex min-h-9 items-center gap-2 rounded-lg border border-[color:var(--color-border-strong)] bg-dark-bg/70 px-3 text-sm text-dark-muted">
          <span className="sr-only">Status</span>
          <select value={status} onChange={(event) => setStatus(event.target.value as StatusFilter)} className="min-h-8 bg-transparent text-sm text-dark-text focus:outline-none">
            <option value="all">All statuses</option>
            <option value="active">Active only</option>
            <option value="paused">Paused and other</option>
          </select>
        </label>
        <label className="flex min-h-9 flex-1 items-center gap-2 rounded-lg border border-[color:var(--color-border-strong)] bg-dark-bg/70 px-3 text-sm md:max-w-xs">
          <Search size={16} className="shrink-0 text-dark-muted" aria-hidden="true" />
          <span className="sr-only">Search</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by name" className="min-h-8 w-full bg-transparent text-sm text-dark-text placeholder:text-[color:var(--color-text-3)] focus:outline-none" />
        </label>
      </div>
      <p className="text-sm text-dark-muted">{visible.length} of {counts[level]} shown. Numbers: {windowLabel}.</p>

      {visible.length === 0 ? (
        <div className="rounded-lg border border-dashed border-dark-border p-6 text-center text-sm text-dark-muted">Nothing matches. Clear the search or change the status filter.</div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden overflow-hidden rounded-lg border border-dark-border md:block">
            <table className="w-full text-left text-sm">
              <thead className="bg-dark-panel2 text-dark-muted">
                <tr>
                  {COLUMNS.map((column) => (
                    <th key={column.key} scope="col" className={cx("px-3 py-2 font-medium", column.align === "right" && "text-right")}>
                      <button type="button" onClick={() => toggleSort(column.key)} className={cx("inline-flex min-h-8 items-center gap-1 rounded hover:text-dark-text", focusRing)} aria-sort={sort.key === column.key ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}>
                        {column.key === "results" ? resultLabel : column.label}
                        {sort.key === column.key ? (sort.dir === "asc" ? <ArrowUp size={14} aria-hidden="true" /> : <ArrowDown size={14} aria-hidden="true" />) : null}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => (
                  <tr key={row.id} className="border-t border-dark-border text-dark-text hover:bg-dark-panel2/60">
                    <td className="max-w-[260px] px-3 py-2">
                      <div className="truncate font-medium" title={row.name}>{row.name}</div>
                      {row.level !== "campaign" && <div className="truncate text-dark-muted" title={row.campaignName || undefined}>{row.level === "ad" && row.adsetName ? `${row.adsetName} · ` : ""}{row.campaignName || "Unknown campaign"}</div>}
                    </td>
                    <td className="px-3 py-2"><StatusBadge row={row} /></td>
                    <td className="px-3 py-2 text-right tnum">{budgetLabel(row, currency)}</td>
                    <td className="px-3 py-2 text-right tnum">{money(row.spend, currency)}</td>
                    <td className="px-3 py-2 text-right tnum">{integer(row.results)}</td>
                    <td className="px-3 py-2 text-right tnum">{money(row.costPerResult, currency)}</td>
                    <td className="px-3 py-2 text-right tnum">{percent(row.ctr)}</td>
                    <td className="px-3 py-2 text-right tnum">{decimal(row.frequency, 1)}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-dark-muted">{shortDate(row.lastChange)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Phone cards */}
          <ul className="space-y-2 md:hidden">
            {visible.map((row) => (
              <li key={row.id} className="rounded-lg border border-dark-border bg-dark-panel2/50 p-3 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="break-words font-medium text-dark-text">{row.name}</div>
                    {row.level !== "campaign" && <div className="break-words text-dark-muted">{row.campaignName || "Unknown campaign"}</div>}
                  </div>
                  <StatusBadge row={row} />
                </div>
                <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 tnum">
                  <dt className="text-dark-muted">Spent</dt><dd className="text-right text-dark-text">{money(row.spend, currency)}</dd>
                  <dt className="text-dark-muted">{resultLabel}</dt><dd className="text-right text-dark-text">{integer(row.results)}</dd>
                  <dt className="text-dark-muted">Cost / result</dt><dd className="text-right text-dark-text">{money(row.costPerResult, currency)}</dd>
                  <dt className="text-dark-muted">Budget</dt><dd className="text-right text-dark-text">{budgetLabel(row, currency)}</dd>
                  <dt className="text-dark-muted">Click rate</dt><dd className="text-right text-dark-text">{percent(row.ctr)}</dd>
                  <dt className="text-dark-muted">Last change</dt><dd className="text-right text-dark-text">{shortDate(row.lastChange)}</dd>
                </dl>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
