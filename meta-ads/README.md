# Meta Ads Agent

A standalone Meta advertising agent with reporting, campaign operations, creative upload, targeting research, experiments, and guardrail rules.

## Safety

Every live write requires `META_ADS_WRITES_ENABLED=true`. Keep it unset for read-only use. Start with a dry run when available. Campaign activation, campaign pausing, and rule creation also require an exact confirmation phrase after approval. Budget edits are supported by `update-budget` and remain subject to the configured budget cap.

## Quick Start

Install dependencies, copy `.env.example` to `.env` inside this folder, add credentials, and run the doctor command. The API client targets Meta Marketing API v25.0.

macOS or Linux (Bash):

```bash
npm install
cp .env.example .env
node src/index.js doctor
```

Windows (PowerShell):

```powershell
npm install
Copy-Item .env.example .env
node .\src\index.js doctor
```

## Carousel Creatives

The `create-carousel-creative` recipe makes ordered carousels with 2 to 10 cards. Run `--dry-run` first. Use square 1:1 slides for Instagram, ideally 1080 by 1080 pixels. The creative is not an ad and is not activated automatically.

See `docs/SETUP.md` for credential setup and platform-specific commands, and `docs/AGENT-PROMPT.md` for the CLI command reference.
