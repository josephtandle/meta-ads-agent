# Meta Ads Agent

This repository contains the standalone Meta Ads agent in [`meta-ads/`](meta-ads/). Read [`meta-ads/README.md`](meta-ads/README.md) for setup and safety instructions.

The agent uses Meta Marketing API v25.0. Every live write requires `META_ADS_WRITES_ENABLED=true`; commands with an exact confirmation phrase require that phrase after approval. Start with a dry run when available.

Before any ad or creative is created, the agent checks the text against Meta's Advertising Standards and shows what to rewrite (`node src/index.js policy check "..."`). See the "Check my ads against Meta's policies" section of `meta-ads/README.md`.
