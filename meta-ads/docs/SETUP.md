# Meta Ads Agent Setup

`AGENT_DIR` means the folder this agent is installed into. Example paths:

- macOS or Linux: `~/agents/meta-ads`
- Windows PowerShell: `$env:USERPROFILE\agents\meta-ads`

The agent uses Meta Marketing API v25.0.

## 1. Create a Meta App

1. Go to https://developers.facebook.com/apps/
2. Create an app and choose the use case named "Create and manage ads with Marketing API".
3. Confirm the Marketing API product is attached.

## 2. Get API Credentials

Generate an access token in your app dashboard using Graph API Explorer, then exchange it for a long-lived token. For ongoing production use, a system user token from Business Manager is recommended.

## Required Permissions

Core scopes for campaign work:

- `ads_management` for reading and managing ads
- `ads_read` for reading account data and insights
- `business_management` for business settings
- `pages_read_engagement` for page data used by ad creatives
- `pages_show_list` for listing pages available as an ad identity

Optional scopes depend on features used: `leads_retrieval`, `pages_manage_ads`, and `catalog_management`.

Find the ad account ID in Business Manager. It has the form `act_XXXXXXXXXXXXXXXXX`.

## 3. Configure Environment

Copy `.env.example` to `.env` in `AGENT_DIR` and fill in the values. Keep `.env` private and never commit it.

macOS or Linux (Bash):

```bash
cd "$HOME/agents/meta-ads"
cp .env.example .env
```

Windows (PowerShell):

```powershell
Set-Location "$env:USERPROFILE\agents\meta-ads"
Copy-Item .env.example .env
```

Add these values to the `.env` file in that folder:

```env
META_ADS_ACCESS_TOKEN=your_long_lived_token_here
META_ADS_ACCOUNT_ID=act_XXXXXXXXXXXXXXXXX
META_ADS_APP_ID=your_app_id
META_ADS_APP_SECRET=your_app_secret
```

## 4. Install Dependencies

From `AGENT_DIR`, run the same cross-platform command in either shell:

```text
npm install
```

## 5. Keep Writes Disabled Until Needed

Every live write requires `META_ADS_WRITES_ENABLED=true`. For read-only use, leave it unset or set it to `false`.

Bash, for the current terminal session:

```bash
export META_ADS_WRITES_ENABLED=false
```

PowerShell, for the current terminal session:

```powershell
$env:META_ADS_WRITES_ENABLED = "false"
```

To enable writes for an approved task, set the value to `true` in the same shell or in the private `.env` file. Handlers that have an exact confirmation phrase still require it after approval. Campaign activation, campaign pausing, and rule creation have exact confirmation phrases.

## 6. Check Readiness

From the parent folder of `AGENT_DIR`, run:

```bash
node "$HOME/agents/meta-ads/src/index.js" doctor
```

```powershell
node "$env:USERPROFILE\agents\meta-ads\src\index.js" doctor
```

Without credentials, the agent stays in offline mode. With credentials, the doctor reports whether live API access is ready.

## 7. Test Connection and Initial Sync

Bash:

```bash
node "$HOME/agents/meta-ads/src/index.js" account
node "$HOME/agents/meta-ads/src/index.js" sync
```

PowerShell:

```powershell
node "$env:USERPROFILE\agents\meta-ads\src\index.js" account
node "$env:USERPROFILE\agents\meta-ads\src\index.js" sync
```

## Carousel Creatives

Use `create-carousel-creative` for an ordered carousel of 2 to 10 cards. Run its `--dry-run` first and review the cards and warnings before enabling a live write. For Instagram, prepare square 1:1 slides, ideally 1080 by 1080 pixels. The recipe creates a creative only, it does not create or activate an ad.

## Rate Limits and Local Data

Meta applies per-account rate limits. The agent caches data locally in `data/` to reduce requests. Keep local cache and audit files private.
