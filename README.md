# Meta Ads Agent for Claude Code

Run real Meta (Facebook and Instagram) ad campaigns through a conversation with Claude Code, with safety rails a professional would insist on.

Built by Joe Che for the "Supercharge Your Meta Ads with Claude Code" course at Masterminds HQ. If you are here from the course: star this repo so you can find it again, then follow the setup guide in `meta-ads/docs/SETUP.md`.

## What it does

- Reporting: account, campaign, ad set, and ad insights, async reports with breakdowns, a weekly dashboard
- Campaign operations: draft offline, create campaigns, ad sets, ads, and creatives, always PAUSED
- Creative: upload images and get creative hashes ready for ads
- Research: search interests and locations, estimate reach before you commit budget
- Testing: A/B experiments through Meta ad studies
- Guardrails: automated rules (for example, pause an ad set when CPA runs hot) behind an explicit confirmation string
- Leads: list lead forms and retrieve leads, read-only

## The safety spine

Nothing spends money without you saying so, three times over:

1. `META_ADS_WRITES_ENABLED=true` must be set before any write command works at all
2. Every mutating command supports `--dry-run`, and campaign activation, pausing, budget changes, and rule creation each require typing an exact CONFIRM string
3. `META_ADS_MAX_DAILY_BUDGET_CENTS` caps every budget the agent can set, and every write attempt lands in a local JSONL audit log

Everything is created PAUSED. The agent never generates or refreshes tokens, and it strips credentials from its own logs.

## Install

Clone this repository, then from the `meta-ads` folder run `npm install` and:

```
node src/index.js doctor
```

`doctor` tells you exactly what is configured and what is missing. Credential setup is documented step by step in `meta-ads/docs/SETUP.md`. Course participants also get a packaged one-paste installer through All Sorted.

## Requirements

Node.js 20 or newer, a Meta ad account, and a Meta app with the "Create and manage ads with Marketing API" use case.
