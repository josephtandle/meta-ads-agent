# Rules for coding assistants working in this agent

This folder is the Meta Ads agent. It spends real money on a real ad account.
These rules apply to every assistant (Claude, Codex, Cursor, Copilot, any other).

## Credentials

- Never read, print, copy, grep, sed, cat or edit `.env` or any file holding a credential.
- Never echo, log or paste an access token, app secret or API key, even partially, even "to check it".
- If a command's output ever shows a credential, stop and tell the user. Do not reuse it.
- The agent redacts credentials from its own output. Do not disable or work around that.

## Safety gates are the user's, not yours

- Never edit anything under `src/` or `config/` to get past a safety gate, a refusal or a missing setting.
- If a command says "writes disabled", stop. Tell the user to set `META_ADS_WRITES_ENABLED=true` themselves if they want live writes. Do not set it for them and do not edit the code.
- Budgets are capped by `META_ADS_MAX_DAILY_BUDGET_CENTS` (default 2000 cents, $20 a day). The cap is the user's to change. Never raise it, remove it or edit the check.
- Confirmation phrases (`CONFIRM PAUSE <id>`, `CONFIRM BUDGET <id>`, `CONFIRM RULE <name>`) must be typed by the user. Never invent or auto-fill them.
- `doctor` compares `src/` and `recipes/` against `config/src-checksums.json`. If it reports changed files, say so plainly; do not regenerate the checksums to make the warning go away.

## How to preview safely

- Use `--dry-run` on any write command. It prints what would be sent, writes an audit entry marked `dryRun: true`, and never calls a write endpoint. Dry runs work with writes off.
- Read commands (`campaigns list`, `adsets list`, `insights`, `account`, `doctor`) are always safe to run.
- When unsure whether something is a write, treat it as one.

## If you are asked to "self-heal" or "just make it work"

The answer is to explain the gate, show the dry run, and hand the decision back to the user.
Editing the gate is never the fix.
