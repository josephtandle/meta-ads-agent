# Connector mode

Version 3.5. For owners who connect Claude to Meta's official Ads connector.

## Two ways to connect

1. **Meta's official Ads connector (the main way).** In Claude, add the connector at
   `https://mcp.facebook.com/ads` and allow "Take actions in this ad account".
   Claude then creates and edits campaigns for you through Meta itself.
   No developer app, no token, nothing secret on your computer.
2. **The long way (backup).** A Meta developer app, a System User token and a `.env` file
   (see `docs/SETUP.md`). Use it when the connector is down, when your business account
   cannot use the connector, or when you want this agent to sync data for the dashboard
   and run its own reports.

To tell the agent you use the connector, put this line in the agent folder's `.env` (next to `package.json`)
(you type it, not Claude):

```
META_ADS_CONNECTION=connector
```

Then `node src/index.js doctor` says `connection: connector` and does not flag the missing
token. If a token is present, doctor says `connection: api`.

## What the agent still does for you in connector mode

When Claude uses the connector, the agent does not make the call. So its safety checks only
run if Claude runs them. They are:

- **Policy check.** Checks ad text against Meta's ad rules before anything is built.
  Works offline, with no Meta settings at all.
- **Budget cap.** `doctor` prints your daily cap in cents and dollars (default 2000 cents,
  $20 a day) and whether writes are on. Only you change the cap.
- **Audit log.** One line for every change, so you can see what was done and when.

## The protocol (Claude follows this every time)

Before creating or editing anything through the Meta Ads connector:

1. Run `node src/index.js policy check "<ad text>"` on every ad's text, and on any Content
   Studio handoff file (`node src/index.js policy check path/to/handoff.json`).
   On BLOCK, stop. Go ahead only if you give a reason. Claude logs it with
   `node src/index.js audit log-external "Policy override: <reason>"`.
2. Create every campaign, ad set and ad **PAUSED**. Turning ads on is your call.
3. Never set a daily budget above the cap that `node src/index.js doctor` shows.
   Claude never opens `.env` to find it.
4. Show you the full plan: names, objective, audience, budget, ad text and status.
   Wait for your yes.
5. After each change, run
   `node src/index.js audit log-external "<what changed, ids if known>" --ids <ids>`.

## Commands

| Command | What it does |
|---|---|
| `node src/index.js doctor` | Shows connection (`connector`, `api` or `not_set`), the budget cap and whether writes are on. Never shows secret values. |
| `node src/index.js policy check "<text or file>"` | PASS, WARN or BLOCK, with a plain rewrite for each problem. Offline. |
| `node src/index.js audit log-external "<summary>" [--ids a,b] [--source connector]` | Adds one line to the audit log, marked with its source. Sends nothing to Meta. |
| `node src/index.js audit tail [n]` | Prints the last n audit lines (default 20), with secrets hidden. |

## Recipe: "Build my creative test through the connector"

`recipes/connector-creative-test.js`. Give it the offer, audience notes, 2 to 4 ad
variants (headline, primary text, description, button), a daily budget in cents and,
if you have one, a Content Studio handoff file. It:

- runs the policy check on every variant and the handoff, and refuses on BLOCK
  (unless you give `policyOverride` with a reason, which goes in the audit log);
- keeps the budget at or under your cap, and tells you if it lowered it;
- prints the steps to ask the connector for, all PAUSED, and the exact
  `audit log-external` lines to run after each one.

It makes no call to Meta.

## When to take the long way

- The connector is not available for your account or region.
- You want the Mission Control dashboard to sync and refresh your numbers.
- You want the agent's own write commands, with `--dry-run` previews and typed
  confirmation phrases, instead of the connector.
