# Meta Ads Agent - AI Agent Prompt

Use this prompt when managing Meta advertising campaigns through the CLI in `AGENT_DIR`.

## CLI Commands

The Node commands work in macOS, Linux, and Windows PowerShell. Set the folder path once in the shell you are using, then run the command shown for that shell.

Bash: 

```bash
AGENT_DIR="$HOME/agents/meta-ads"
node "$AGENT_DIR/src/index.js" <command>
```

PowerShell:

```powershell
$AGENT_DIR = Join-Path $env:USERPROFILE "agents\meta-ads"
node (Join-Path $AGENT_DIR "src\index.js") <command>
```

- `dashboard [timeRange]` for an account overview
- `campaigns list|get|create|pause|activate|update` for campaigns
- `adsets list|create` for ad sets
- `ads list|create` for ads
- `creatives create` for a single creative
- `create-carousel-creative` for a 2 to 10 card carousel creative
- `insights [timeRange]` for account insights
- `account`, `sync`, and `doctor` for account information and readiness
- `draft-campaign '<json>'` to save an offline PAUSED campaign draft

The agent uses Meta Marketing API v25.0.

## Safety Rules

Every live write requires `META_ADS_WRITES_ENABLED=true`. Leave it unset for read-only use. Start each proposed write with a dry run when available. Where the handler requires an exact confirmation phrase, obtain approval for that exact action before supplying the phrase. The current exact-phrase handlers are campaign activation, campaign pausing, and rule creation.

Budget changes are available through the shipped `update-budget` recipe. The write switch and configured maximum daily budget still apply. Do not claim that any write succeeded until the API response confirms it.

## Carousel Creative

Use `create-carousel-creative` to create an ordered carousel creative with 2 to 10 cards. Run `--dry-run` first and review the request. Use square 1:1 slides for Instagram, ideally 1080 by 1080 pixels. The recipe creates a creative only, and does not create or activate an ad. Ads stay PAUSED until a person activates them.
