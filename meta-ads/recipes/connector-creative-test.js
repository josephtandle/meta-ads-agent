const policy = require("../src/policy-check");
const { writeAudit } = require("../src/audit-log");
const { readEnvFile, budgetCapStatus } = require("../src/readiness");
const { readArg } = require("../src/recipe-helpers");

// Plans a 2 to 4 variant creative test that Claude then builds through Meta's
// official Ads connector. This recipe makes NO call to Meta. It runs the policy
// check on every variant and the Content Studio handoff, refuses on BLOCK
// (unless policyOverride holds a reason, which is audited), keeps the daily
// budget at or under the cap, and prints the connector steps (all PAUSED) plus
// the audit lines to run afterwards.

const ACTION = "connector creative test (recipe)";

function clean(value) {
  return String(value === undefined || value === null ? "" : value).trim();
}

// Text that goes inside a double-quoted shell argument: drop characters the
// shell would expand or that would end the quote.
function shellSafe(value) {
  return clean(value).replace(/["`$\\]/g, "").replace(/\s+/g, " ");
}

function dollars(cents) {
  return `$${(Number(cents) / 100).toFixed(2)}`;
}

function normalizeVariant(raw, index) {
  const variant = raw && typeof raw === "object" ? raw : {};
  const label = clean(variant.label || variant.name) || `Variant ${String.fromCharCode(65 + index)}`;
  return {
    label,
    headline: clean(variant.headline || variant.title),
    primaryText: clean(variant.primaryText || variant.primary_text || variant.body || variant.message),
    description: clean(variant.description),
    cta: clean(variant.cta || variant.callToAction || "LEARN_MORE").toUpperCase().replace(/\s+/g, "_"),
  };
}

function findingLines(report) {
  return report.findings.map((f) => `  - ${f.level} ${f.ruleId}: "${f.phrase}"${f.rewrite ? `. Try: ${f.rewrite}` : ""}`);
}

module.exports.runRecipe = async function runRecipe(input = {}) {
  const offer = clean(readArg(input, ["offer", "product"], ""));
  const audienceNotes = clean(readArg(input, ["audienceNotes", "audience"], ""));
  const link = clean(readArg(input, ["link", "destinationUrl", "url"], ""));
  const objective = clean(readArg(input, ["objective"], "OUTCOME_LEADS")) || "OUTCOME_LEADS";
  const rawVariants = readArg(input, ["variants", "creatives"], []);
  const requestedBudget = readArg(input, ["dailyBudgetCents", "daily_budget", "budgetCents"], undefined);
  const handoff = readArg(input, ["handoff"], null);
  const handoffFile = clean(readArg(input, ["handoffFile", "handoffPath", "file"], ""));
  const overrideRaw = readArg(input, ["policyOverride"], undefined);

  if (!offer) throw new Error("Tell me the offer (what you are selling) so the campaign has a name.");
  if (!Array.isArray(rawVariants) || rawVariants.length < 2 || rawVariants.length > 4) {
    throw new Error("A creative test needs 2 to 4 variants, each with a headline and primary text.");
  }
  const variants = rawVariants.map(normalizeVariant);
  const incomplete = variants.filter((v) => !v.headline || !v.primaryText).map((v) => v.label);
  if (incomplete.length) throw new Error(`Each variant needs a headline and primary text. Missing in: ${incomplete.join(", ")}.`);
  const budgetAsked = Number(requestedBudget);
  if (!Number.isFinite(budgetAsked) || budgetAsked <= 0) throw new Error("Tell me the daily budget in cents (for example 1000 for $10 a day).");

  // 1. Policy check on every variant and on the handoff.
  const checks = variants.map((v) => ({
    label: v.label,
    report: policy.checkCreative({ headline: v.headline, primaryText: v.primaryText, description: v.description, callToAction: v.cta, ...(link ? { link } : {}) }),
  }));
  if (handoff && typeof handoff === "object") checks.push({ label: "Content Studio handoff", report: policy.checkCreative(handoff) });
  if (handoffFile) {
    const resolved = await policy.resolvePolicyInput(handoffFile);
    checks.push({ label: `Handoff file ${handoffFile}`, report: policy.checkCreative(resolved.input) });
  }
  const blocked = checks.filter((c) => c.report.status === "BLOCK");
  const warned = checks.filter((c) => c.report.status === "WARN");
  const overrideReason = typeof overrideRaw === "string" ? overrideRaw.trim() : "";
  const policySummary = checks.map((c) => ({ label: c.label, status: c.report.status, ruleIds: [...new Set(c.report.findings.map((f) => f.ruleId))] }));

  if (blocked.length && !overrideReason) {
    const lines = [
      "Refused: Meta is likely to reject this ad text, so nothing should be built through the connector yet.",
      ...blocked.flatMap((c) => [`${c.label}:`, ...findingLines(c.report)]),
      "Fix the text with the rewrites above and run this again. If you are sure it is fine, give a reason as policyOverride; the reason is saved in the audit log.",
    ];
    return { status: "blocked", reply: lines.join("\n"), metadata: { policy: policySummary, sentToMeta: false } };
  }
  if (blocked.length && overrideReason) {
    const ruleIds = [...new Set(blocked.flatMap((c) => c.report.findings.filter((f) => f.level === "BLOCK").map((f) => f.ruleId)))];
    writeAudit(
      `POLICY OVERRIDE ${ACTION}`,
      { action: ACTION, reason: overrideReason, ruleIds, variants: blocked.map((c) => c.label) },
      { overridden: true, status: "BLOCK", sentByThisAgent: false, findings: blocked.flatMap((c) => c.report.findings.map((f) => ({ level: f.level, ruleId: f.ruleId, phrase: f.phrase }))) },
      { source: "connector" },
    );
  }

  // 2. Budget: never above the cap.
  const cap = budgetCapStatus(process.env, readEnvFile());
  if (cap.limitCents === null) {
    return { status: "blocked", reply: "Refused: the budget cap setting (META_ADS_MAX_DAILY_BUDGET_CENTS) is not a valid number, so no budget is safe. Fix it in your settings, then run this again.", metadata: { policy: policySummary, sentToMeta: false } };
  }
  const budgetCents = Math.min(Math.round(budgetAsked), cap.limitCents);
  const clamped = budgetCents < Math.round(budgetAsked);

  // 3. The connector plan. Everything PAUSED.
  const campaignName = shellSafe(readArg(input, ["campaignName"], "")) || `${shellSafe(offer)} - creative test`;
  const adSetName = `${campaignName} - ad set`;
  const steps = [
    `1. Ask the Meta Ads connector to create a campaign named "${campaignName}", objective ${objective}, status PAUSED, no campaign budget.`,
    `2. Ask it to create one ad set "${adSetName}" in that campaign: daily budget ${budgetCents} cents (${dollars(budgetCents)} a day), audience: ${audienceNotes || "ask the owner"}, status PAUSED.`,
    ...variants.map((v, i) => `${i + 3}. Ask it to create ad "${campaignName} - ${shellSafe(v.label)}" in that ad set, status PAUSED: headline "${v.headline}", primary text "${v.primaryText}"${v.description ? `, description "${v.description}"` : ""}, button ${v.cta}${link ? `, link ${link}` : ""}.`),
    `${variants.length + 3}. Ask the connector to read back the campaign, ad set and ads. Check every status says PAUSED and the budget is ${dollars(budgetCents)}.`,
  ];
  const auditLines = [
    `node src/index.js audit log-external "Created campaign ${campaignName} (PAUSED, ${objective}) via connector" --ids <campaign id>`,
    `node src/index.js audit log-external "Created ad set ${adSetName} (PAUSED, ${budgetCents} cents a day) via connector" --ids <ad set id>`,
    ...variants.map((v) => `node src/index.js audit log-external "Created ad ${campaignName} - ${shellSafe(v.label)} (PAUSED) via connector" --ids <ad id>`),
  ];

  const reply = [
    `Creative test plan for the Meta Ads connector (${variants.length} variants). Nothing has been sent to Meta.`,
    "",
    `Policy check: ${blocked.length ? `BLOCK overridden (reason logged: ${overrideReason})` : warned.length ? `WARN on ${warned.map((c) => c.label).join(", ")}; read the notes below before going ahead` : "PASS on every variant"}.`,
    ...warned.flatMap((c) => [`${c.label}:`, ...findingLines(c.report)]),
    clamped
      ? `Budget: you asked for ${Math.round(budgetAsked)} cents (${dollars(budgetAsked)}) a day. The cap is ${cap.limitCents} cents (${cap.limitDollars}), so the plan uses ${budgetCents} cents (${dollars(budgetCents)}). Only you can raise the cap.`
      : `Budget: ${budgetCents} cents (${dollars(budgetCents)}) a day, within the ${cap.limitDollars} cap.`,
    "",
    "Show this plan to the owner and wait for a clear yes. Then:",
    ...steps,
    "",
    "After each change, run these so the agent's audit log stays complete (put in the real ids):",
    ...auditLines,
  ].join("\n");

  return {
    status: "ok",
    reply,
    metadata: {
      sentToMeta: false,
      status: "PAUSED",
      objective,
      campaignName,
      dailyBudgetCents: budgetCents,
      requestedDailyBudgetCents: Math.round(budgetAsked),
      budgetClamped: clamped,
      budgetCapCents: cap.limitCents,
      policy: policySummary,
      ...(blocked.length ? { policyOverride: overrideReason } : {}),
      variants,
      steps,
      auditLines,
    },
  };
};
