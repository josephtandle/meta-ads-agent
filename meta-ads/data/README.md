# data/

The agent writes its local cache and offline campaign drafts here:

- `dashboard.json`, `campaigns.json`, `adsets.json`, `audiences.json`, `pixels.json`, `insights.json`, `account.json`, `last-sync.json` are cache files written by `sync` and `dashboard`.
- `draft-<timestamp>-<name>.json` files are offline campaign drafts written by `draft-campaign`.

Everything in this folder is generated from your own ad account. Treat it as private business data: keep it out of version control and never share it.
