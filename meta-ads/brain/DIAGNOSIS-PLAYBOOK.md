# Diagnosis Playbook

## How to use this file

Use this sequence before recommending a pause, scale, rebuild, or attribution conclusion. Run the actual read-only agent commands from `agents/meta-ads`, compare them with CRM, checkout, and customer evidence, then record the binding constraint in `data/STRATEGY.md`. Live changes require separate approval.

Sam Tomlinson's useful ordering is business context, operations and unit economics, data infrastructure, architecture, creative, then testing. His observation is that about 1 in 3 accounts has a major tracking mistake [practitioner-consensus]. The rule for conflict is equally important: when data and anecdotes disagree, the anecdotes are usually right until the instrumentation explains why. An anecdote is not a substitute for a sample, but it is a reason to audit the sample and the event definition.

## 1. Unit economics and operating reality

**What to run:** `node src/index.js dashboard last_30d`; `node src/index.js insights last_30d`; read the account's `data/STRATEGY.md`. Reconcile spend with CRM revenue, qualified applications, show rate, close rate, refunds, delivery capacity, and margin.

**What good looks like:** the target event maps to value, CPA or CAC ceiling is documented, sales capacity is available, and platform spend can be tied to qualified outcomes.

**What bad looks like:** CPL is the declared success metric for a sales-led offer, the close rate is unknown, an offer is capacity constrained, or a profitable-looking platform campaign creates refunds or poor-fit customers.

**False diagnosis to avoid:** calling this a targeting or creative problem before proving the business can profit from the conversion it buys.

## 2. Tracking integrity and event definitions

**What to run:** `node src/index.js pixels list`; `node src/index.js pixels stats <pixel-id> last_30d`; `node src/index.js insights last_7d`; `node src/index.js insights last_30d`. Compare pixel events with CAPI, CRM timestamps, checkout, and source-of-truth sales records. Audit `event_id` deduplication, event names, values, and time zones.

**What good looks like:** Pixel and CAPI both cover meaningful events, duplicates are controlled, count and value discrepancies have an explanation, and the optimisation event matches the commercial event.

**What bad looks like:** missing CAPI events, duplicate purchase counts, stale timestamps, raw leads presented as qualified leads, or large CRM-platform gaps with no audit trail.

**False diagnosis to avoid:** changing bids or creative to repair a measurement problem. Roughly 1 in 3 accounts has a major tracking issue [practitioner-consensus], so audit before believing a surprising dashboard.

## 3. Structure, learning, and delivery constraints

**What to run:** `node src/index.js campaigns list`; `node src/index.js adsets list`; `node src/index.js insights campaign <campaign-id> last_30d`; `node src/index.js insights adset <adset-id> last_30d`; `node src/index.js targeting reach '<targeting-spec-json>'` only where a real restriction needs validation.

**What good looks like:** a small number of ad sets receives enough volume for the selected event, exclusions are intentional, no duplicate audiences compete, and daily funding is plausibly at least 5x target CPA [practitioner-consensus].

**What bad looks like:** many low-spend ad sets, overlapping interest stacks, bid caps starving delivery, repeated learning resets, or a deep event with less than the `target CPA x 50 / 7` learning budget [meta-official].

**False diagnosis to avoid:** treating fragmentation as audience sophistication, or treating every single ad as an independent business. Judge the ad set and campaign before judging a creative.

## 4. Creative volume, fatigue, hook, and hold

**What to run:** `node src/index.js ads list <adset-id>`; `node src/index.js insights ad <ad-id> last_7d`; `node src/index.js insights ad <ad-id> last_30d`; optionally `node src/index.js ad-library search '<category or competitor term>' '<countries>'` for pattern research. Compare current assets with the creative launch log.

**What good looks like:** a steady stream of new concepts, stable frequency, and leading video metrics that point to one clear iteration. Cold frequency is below 3.0, or performance is healthy despite it [practitioner-consensus].

**What bad looks like:** frequency above 3.0 cold, or CTR/ROAS down more than 10 to 15% week over week [practitioner-consensus], with no fresh angles. Low hook rate, 3-second views/impressions, means fix seconds 0 to 3. Low hold rate, 15-second plays/3-second views, after a workable hook means reveal payoff sooner in seconds 3 to 15.

**False diagnosis to avoid:** calling every decline “fatigue.” Check budget changes, placement mix, landing conversion, and tracking before refreshing a true winner.

## 5. Click-to-page message match

**What to run:** `node src/index.js insights ad <ad-id> last_30d`; `node src/index.js insights adset <adset-id> last_30d`; open the approved landing-page and ad creative side by side outside this agent. Record page sessions, mobile speed, form starts, and form completions from the analytics source of truth.

**What good looks like:** the first page screen confirms the promise, mechanism, proof, and CTA implied by the ad. Mobile flow is fast and an expected price or next step is not hidden.

**What bad looks like:** healthy CTR with weak landing conversion, ad language that does not appear on the page, long forms, price surprise, vague proof, or a founder/demo promise that turns into generic copy.

**False diagnosis to avoid:** replacing the ad because click-through is strong but conversion is weak. This is usually a page-message or friction hypothesis first.

## 6. Checkout, calendar, qualification, and handoff

**What to run:** `node src/index.js leads forms`; `node src/index.js leads get <form-id>` when approved and within access policy; `node src/index.js insights last_30d`. Reconcile form submit to qualified application, booked call, attended call, purchase, and closed-won in the CRM. Check calendar availability, payment errors, and actual response time.

**What good looks like:** every handoff is owned, leads get timely contact, calendar inventory exists, payment works, and the quality loop returns qualified outcomes through CAPI.

**What bad looks like:** cheap leads that never book, booked calls that cannot find a time, abandoned checkout, no sales response, or a form that admits people the sales team immediately rejects. For lead-driven offers, a five-minute response target can materially improve conversion; one cross-industry estimate reports up to 9x conversion versus 30-minute response [single-source].

**False diagnosis to avoid:** calling the platform lead quality poor when the form, follow-up, sales capacity, or qualification definition is the cause.

## 7. Attribution trustworthiness and incrementality

**What to run:** `node src/index.js dashboard last_30d`; `node src/index.js insights last_30d`; compare platform purchases and revenue to CRM, ecommerce, post-purchase survey, MER, aMER, branded search, and any lift or geo-holdout results. Use `node src/index.js insights campaign <campaign-id> last_30d` to locate, not prove, attribution differences.

**What good looks like:** platform reports, first-party records, surveys, and blended efficiency tell a compatible story. Differences are expected and documented rather than hidden.

**What bad looks like:** one dashboard claims a large incrementality effect while revenue, new-customer mix, survey mentions, or MER does not move. Seer's comparison of Meta's 87% self-reported incrementality with 67% versus GA4 illustrates why platform reports are directional [benchmark-study].

**False diagnosis to avoid:** assuming either platform or GA4 is uniquely authoritative. Use a measurement ladder, and use a holdout when stakes justify it.

### Read-only command discipline

The commands above are deliberately scoped. Start at account level, then campaign, ad set, and ad only when the previous level identifies a real variance. Use a 7-day view for recent delivery changes and a 30-day view for trend context. The agent can show delivery and platform attribution, but it cannot establish business truth without CRM, checkout, survey, and operations evidence supplied through approved channels. Do not use diagnostic access to activate, pause, or change budget.

When an insight report lacks a breakdown needed for a high-spend decision, use `node src/index.js insights async <object-id> <breakdowns> <range>` and then `node src/index.js insights report <report-run-id>`. Record the date range and breakdown selected, because changing either can make a “trend” disappear. A more granular report is not necessarily a more accurate conclusion if it slices the data below meaningful volume.

## The two attribution mismatch patterns

**Platform strong, revenue weak:** inspect existing-customer share, view-through credit, retargeting exposure, refund rate, checkout, CRM qualification, surveys, and MER. This pattern often indicates existing-customer or view-through inflation, not a reason to scale. The appropriate action is to establish incremental value before increasing spend.

**Platform weak, revenue strong:** do not cut immediately. Meta may be creating demand that search, direct, email, or another channel receives credit for. Inspect new-customer revenue, surveys, branded search, lead-to-sale timing, and total efficiency. The appropriate action is a bounded incrementality test or careful hold, not a reflexive pause.

These patterns can coexist inside one account. Cold prospecting may be platform-weak but incrementally valuable, while retargeting may be platform-strong but mostly harvesting existing demand. Segment conclusions by campaign purpose and customer status. Never use a blended account ROAS number to hide that difference.

## Close every diagnosis

End the review with one sentence each for: the binding constraint, evidence that supports it, evidence that would falsify it, the next test, its guardrail, and its kill date. Do not turn a diagnosis into a live edit without approval.

Use “unknown” when the available data cannot separate two explanations. That is a productive result. It tells the operator what information must be collected next, such as a CRM status audit, landing-page session replay review, or a controlled creative contrast. False confidence is more expensive than a short, well-scoped period of observation.
