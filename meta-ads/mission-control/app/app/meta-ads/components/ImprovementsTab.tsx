"use client";

// Proposals grouped by Scale, Fix, Stop, Watch. Each card carries the evidence
// numbers, a plain next step and a dry-run command to copy. Nothing on this tab
// performs a write: the commands preview a change, and the agent asks for a
// typed confirmation before anything live.

import { useState } from "react";
import { Check, Copy, Shield } from "lucide-react";
import type { Card, Improvements, Section } from "./types";
import { isEmpty, isFailure } from "./types";
import { formatValue } from "./format";
import { Button, InlineError, Notice, Panel, Pill, cx } from "./ui";

const GROUP_TONE: Record<Card["group"], string> = {
  scale: "border-l-emerald-400",
  fix: "border-l-[color:var(--color-warn)]",
  stop: "border-l-[color:var(--color-danger)]",
  watch: "border-l-[color:var(--color-purple)]",
};

const RISK_TONE: Record<Card["risk"], "good" | "warn" | "bad"> = { low: "good", medium: "warn", high: "bad" };

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };
  return (
    <Button variant="ghost" onClick={copy} icon={copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />} aria-label="Copy command">
      {copied ? "Copied" : "Copy"}
    </Button>
  );
}

function ImprovementCard({ card, currency }: { card: Card; currency: string }) {
  return (
    <article className={cx("rounded-lg border border-dark-border border-l-4 bg-dark-panel p-4", GROUP_TONE[card.group])}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="text-base font-semibold leading-6 text-dark-text">{card.title}</h3>
        <div className="flex flex-wrap gap-1.5">
          <Pill tone={RISK_TONE[card.risk]} title={card.riskNote}>{card.risk} risk</Pill>
          {card.source === "planner" && <Pill title="From the optimizer's last run">optimizer</Pill>}
        </div>
      </div>
      <p className="mt-2 text-sm leading-6 text-dark-text"><span className="font-medium">Do this:</span> {card.what}</p>
      <p className="mt-1 text-sm leading-6 text-dark-muted"><span className="font-medium text-dark-text">Why:</span> {card.why}</p>
      <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {card.evidence.map((item) => (
          <div key={item.label} className="rounded-md bg-dark-panel2/70 px-2.5 py-2">
            <dt className="text-sm leading-5 text-dark-muted">{item.label}</dt>
            <dd className="break-words text-sm font-semibold leading-5 text-dark-text tnum">{formatValue(item.value, item.format, currency)}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-sm leading-6 text-dark-muted"><span className="font-medium text-dark-text">Expected:</span> {card.expectedEffect}</p>
      <p className="mt-1 text-sm leading-6 text-dark-muted"><span className="font-medium text-dark-text">Risk:</span> {card.riskNote}</p>
      <p className="mt-1 text-sm leading-6 text-dark-muted"><span className="font-medium text-dark-text">Next step:</span> {card.nextStep}</p>
      {card.command && (
        <div className="mt-3 flex items-start gap-2 rounded-md border border-dark-border bg-dark-bg/70 p-2">
          <code className="min-w-0 flex-1 break-all px-1 py-1.5 font-mono text-sm leading-5 text-dark-text">{card.command}</code>
          <CopyButton text={card.command} />
        </div>
      )}
      {card.recipe && <p className="mt-2 text-sm text-dark-muted">Recipe: <code className="font-mono">{card.recipe}</code></p>}
    </article>
  );
}

export function ImprovementsTab({ data, onRetry }: { data: Section<Improvements> | null; onRetry: () => void }) {
  if (!data) return null;
  if (isFailure(data)) return <InlineError message={data.error} onRetry={onRetry} />;
  if (isEmpty(data)) return <Notice>{data.message}</Notice>;
  const currency = data.currency;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-sm text-dark-muted">
        <Shield size={16} className="text-cm-purple" aria-hidden="true" />
        <span>{data.contract}</span>
      </div>
      {data.note && <Notice tone={data.total ? "info" : "warn"}>{data.note}</Notice>}
      {data.groups.map((group) => (
        <Panel key={group.key} title={<span>{group.label} <span className="text-dark-muted tnum">{group.cards.length}</span></span>} aside={group.blurb}>
          {group.cards.length === 0 ? (
            <p className="text-sm text-dark-muted">Nothing here right now.</p>
          ) : (
            <div className="space-y-3">
              {group.cards.map((card) => <ImprovementCard key={card.id} card={card} currency={currency} />)}
            </div>
          )}
        </Panel>
      ))}
      {data.plannerWarnings.length > 0 && (
        <p className="text-sm text-dark-muted">Optimizer flags from its last run: {data.plannerWarnings.join(", ").replace(/_/g, " ")}.</p>
      )}
    </div>
  );
}
