# Meta Ads Agent

A standalone Meta (Facebook + Instagram) advertising agent: a Node CLI plus agent recipes for managing campaigns, ad sets, ads, creatives, audiences, pixels, and insights through the Meta Marketing API.

## Safety model

- Every campaign, ad set, and ad is created **PAUSED**. Activation is a separate, deliberate command.
- Budget changes and activation always require the account owner's explicit approval.
- Without credentials the agent runs in offline copilot mode: readiness checks and local campaign drafts only. No live API call ever happens until you add credentials.

## Quick start

```bash
npm install
cp .env.example .env   # fill in your Meta credentials
node src/index.js doctor
node src/index.js account
node src/index.js sync
node src/index.js dashboard
```

See `docs/SETUP.md` for the full credential walkthrough (Meta app, permissions, long-lived tokens, system users) and `docs/AGENT-PROMPT.md` for the AI-agent system prompt that drives this CLI.

## Layout

- `src/` - CLI orchestrator, Meta Graph API client, offline draft copilot, readiness checks
- `recipes/` - structured recipes (list campaigns, insights, pause/activate, dashboard) for agent runtimes
- `config/config.json` - API version, required env vars, objectives, placements, metrics
- `data/` - local cache and drafts (private; never commit)
- `.env.example` - credential template; copy to `.env`
