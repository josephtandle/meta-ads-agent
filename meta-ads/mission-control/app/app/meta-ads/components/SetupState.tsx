"use client";

// Shown when the agent has no Meta credentials yet: what to add, where, and a
// link to the agent's own setup check. Credential values never appear here;
// the agent only reports which names are present.

import { KeyRound, Stethoscope } from "lucide-react";
import type { Freshness } from "./types";
import { Notice } from "./ui";

const WHAT_EACH_IS: Record<string, string> = {
  META_ADS_ACCESS_TOKEN: "a long-lived System User token from Meta Business Settings (ads_read, ads_management)",
  META_ADS_ACCOUNT_ID: "your ad account id in act_ form, from Ads Manager",
  META_ADS_APP_ID: "the id of your Meta app",
  META_ADS_APP_SECRET: "that app's secret, from the app dashboard",
};

export function SetupState({ freshness }: { freshness: Freshness }) {
  return (
    <section className="mx-auto max-w-2xl space-y-4">
      <div className="rounded-xl border border-dark-border bg-dark-panel p-6">
        <KeyRound className="h-8 w-8 text-cm-purple" aria-hidden="true" />
        <h2 className="mt-4 text-xl font-semibold text-dark-text">Connect your Meta ad account</h2>
        <p className="mt-2 text-sm leading-6 text-dark-muted">
          The dashboard reads your campaigns, spend and results from your own ad account. It needs {freshness.missing.length} more setting{freshness.missing.length === 1 ? "" : "s"} in the agent&apos;s <code className="font-mono text-dark-text">{freshness.envFile}</code> file. Nothing is sent anywhere until they are there, and the agent never prints their values.
        </p>
        <ol className="mt-4 space-y-2 text-sm leading-6 text-dark-text">
          {freshness.missing.map((name) => (
            <li key={name} className="rounded-md bg-dark-panel2/70 px-3 py-2">
              <code className="font-mono font-medium">{name}</code>
              <span className="text-dark-muted">: {WHAT_EACH_IS[name] || "see the setup guide"}</span>
            </li>
          ))}
        </ol>
        <p className="mt-4 text-sm leading-6 text-dark-muted">
          Add each as <code className="font-mono text-dark-text">NAME=value</code> on its own line, then run <code className="font-mono text-dark-text">node src/index.js doctor</code> in the agent folder and press Refresh here. The full walkthrough is in <code className="font-mono text-dark-text">{freshness.setupDoc}</code>.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <a href="/api/meta-ads/doctor" target="_blank" rel="noreferrer" className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-[color:var(--color-border-strong)] bg-dark-panel2 px-3.5 text-sm font-medium text-dark-text hover:border-cm-purple/70">
            <Stethoscope size={16} aria-hidden="true" /> Open the setup check (doctor)
          </a>
        </div>
      </div>
      <Notice>
        While you set this up, the agent still works offline: it can draft campaigns, preview carousel creatives and show this page. Live writes stay off ({freshness.writesEnabled ? "they are on right now" : "META_ADS_WRITES_ENABLED is not true"}), and every budget write is capped at {freshness.budgetCap.limitCents !== null ? `${(freshness.budgetCap.limitCents / 100).toFixed(2)} ${freshness.account.currency} a day` : "an invalid value, so budget writes are refused"}.
      </Notice>
    </section>
  );
}
