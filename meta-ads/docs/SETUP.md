# Meta Ads Agent Setup

`AGENT_DIR` below means the folder this agent is installed into (for example `~/agents/meta-ads` or wherever your installer placed it).

## 1. Create a Meta App

1. Go to https://developers.facebook.com/apps/
2. Create a new app and choose the use case named "Create and manage ads with Marketing API". Do not pick "Other" and do not create a plain Business-type app; those routes can hide the ads permissions you need later.
3. Confirm the Marketing API product is attached (the use case above adds it automatically)

## 2. Get API Credentials

### Access Token (Long-lived)
1. In your app dashboard: Tools, then Graph API Explorer
2. Select your app and the permissions listed below
3. Generate a User Access Token
4. Exchange it for a long-lived token (60 days):
   ```
   GET /oauth/access_token?grant_type=fb_exchange_token
     &client_id={APP_ID}
     &client_secret={APP_SECRET}
     &fb_exchange_token={SHORT_LIVED_TOKEN}
   ```
5. For permanent access: create a System User in Business Manager and generate a token there. System user tokens do not expire and are the recommended production setup.

### Required Permissions / Scopes

Core (request these five for the agent's campaign work):
- `ads_management` - create, edit, and manage ads
- `ads_read` - read ad account data and insights
- `business_management` - manage business settings
- `pages_read_engagement` - read page data for ad creatives
- `pages_show_list` - list the pages your login can use as an ad identity

Optional (request only if you use these features):
- `leads_retrieval` - pull lead form results with the leads commands
- `pages_manage_ads` - manage page-connected ads
- `catalog_management` - product catalog access, dynamic ads work only

### Ad Account ID
- Found in Business Manager under Ad Accounts
- Format: `act_XXXXXXXXXXXXXXXXX`

## 3. Configure Environment

Copy `.env.example` to `.env` inside `AGENT_DIR` and fill in your values:

```env
META_ADS_ACCESS_TOKEN=your_long_lived_token_here
META_ADS_ACCOUNT_ID=act_XXXXXXXXXXXXXXXXX
META_ADS_APP_ID=your_app_id
META_ADS_APP_SECRET=your_app_secret
```

Never commit `.env` to version control.

## 4. Install Dependencies

```bash
cd AGENT_DIR
npm install
```

## 5. Check Readiness

```bash
node AGENT_DIR/src/index.js doctor
```

Without credentials the agent stays in offline copilot mode (drafts only). With credentials it reports `ready_for_live_api`.

## 6. Test Connection and Initial Sync

```bash
node AGENT_DIR/src/index.js account
node AGENT_DIR/src/index.js sync
```

## API Rate Limits
- Standard: 200 calls per hour per ad account
- Insights: 60 calls per hour (heavier quota)
- Batch requests: up to 50 operations per batch
- The agent caches data locally in `data/` to minimize API calls

## Safety Switches (recommended)

The agent ships with three independent safety layers. Set these in the same `.env`:

- `META_ADS_WRITES_ENABLED=true` is required before ANY write command works. Leave it unset for read-only use.
- `META_ADS_MAX_DAILY_BUDGET_CENTS=5000` caps every budget the agent can set (5000 = $50/day). The agent refuses anything above it.
- `META_ADS_AUDIT_LOG_PATH` (optional) moves the JSONL audit log; by default every write attempt is recorded in `data/audit.jsonl`.

Every mutating command also supports `--dry-run`, which prints exactly what would be sent without calling the API, and campaign activation, pausing, and rule creation each require typing an exact CONFIRM string.

## Token Renewal
- Long-lived user tokens expire in 60 days
- System user tokens (Business Manager) never expire; recommended for production
- Set a calendar reminder to refresh user tokens before expiry
