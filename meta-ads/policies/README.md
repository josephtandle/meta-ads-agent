## Check my ads against Meta's policies

Meta rejects ads that break its Advertising Standards, and too many rejections can restrict your ad account.
This agent reads your ad text before anything is created and tells you, in plain words, what Meta is likely to object to and how to rewrite it.

Check any ad yourself:

```bash
node src/index.js policy check "Are you struggling with anxiety? Feel better in 7 days, guaranteed."
node src/index.js policy check my-creative.json          # a creative or carousel spec
node src/index.js policy check exports/meta-carousel.json # a Content Studio handoff, image text included
node src/index.js policy check 120200000000000            # an ad or creative id from your last sync
node src/index.js policy check "..." --json               # for scripts
node src/index.js policy rules                            # every rule the agent knows
```

It checks the headline, primary text, description, button, image text and link. Each problem comes back as:

- **BLOCK**: Meta will very likely reject this. Fix it first.
- **WARN**: check it. It may limit delivery, need an 18+ audience, need Meta's permission, or need a Special Ad Category (housing, jobs, credit, politics).
- **PASS**: nothing the agent knows about.

Every result shows the exact phrase, why it is a problem, and a suggested rewrite. Exit codes: 2 for BLOCK, 1 for WARN, 0 for PASS.

### You are protected without asking

`ads create`, `creatives create`, `creatives carousel` and `draft-campaign` run the same check first, dry runs included.
A BLOCK stops the command and shows the rewrites. If you are sure the text is fine (for example Meta support approved it), add
`--policy-override "<your reason>"`. The reason and the rules you overrode are saved in the audit log. A WARN prints and carries on.
The writes switch and the daily budget cap still apply exactly as before.

### Meta rejected an ad

Use the recipe "Fix an ad Meta rejected" (`recipes/rejected-ad-fix.js`) with Meta's rejection text, the ad id, or both.
It maps the reason to the rules, points at the phrases to change and drafts the fix. Nothing is sent to Meta.

### Where the rules live

- `policies/meta-advertising-standards.md`: Meta's rules in plain words, with links to Meta's pages.
- `policies/rules.json`: the patterns the check uses. Each rule has an id, a level, an explanation and a rewrite hint. Add your own by copying one.

Meta changes its rules often. `doctor` warns when the guide is more than 90 days old. The check is a safety net, not a guarantee: Meta reviews images, video and landing pages too.
