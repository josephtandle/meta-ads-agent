#!/usr/bin/env node

/**
 * Meta Ads Agent - Core Orchestrator
 *
 * CLI interface for managing Meta (Facebook + Instagram) advertising.
 *
 * Usage:
 *   node src/index.js dashboard [timeRange]           - Full account dashboard
 *   node src/index.js campaigns list                  - List all campaigns
 *   node src/index.js campaigns get <id>              - Get campaign details
 *   node src/index.js campaigns create '<json>'       - Create campaign (PAUSED)
 *   node src/index.js campaigns pause <id> [--confirm "CONFIRM PAUSE <id>"] - Pause campaign
 *   node src/index.js campaigns activate <id> [--confirm "CONFIRM ACTIVATE <id>"] - Activate campaign
 *   node src/index.js campaigns update <id> '<json>'  - Update campaign
 *   node src/index.js campaigns budget <id> <cents> [--confirm "CONFIRM BUDGET <id>"] - Update campaign daily budget
 *   node src/index.js adsets list [campaignId]         - List ad sets
 *   node src/index.js adsets create '<json>'           - Create ad set
 *   node src/index.js adsets budget <id> <cents> [--confirm "CONFIRM BUDGET <id>"] - Update ad set daily budget
 *   node src/index.js ads list [adsetId]               - List ads
 *   node src/index.js ads create '<json>'              - Create ad
 *   node src/index.js creatives create '<json>'        - Create ad creative
 *   node src/index.js creatives carousel <spec.json|'<json>'> [--dry-run] - Create carousel creative
 *   node src/index.js creatives carousel --example    - Print carousel spec template
 *   node src/index.js images upload <path|url> [name]  - Upload an ad image
 *   node src/index.js images list                       - List ad images
 *   node src/index.js insights [timeRange]             - Account insights
 *   node src/index.js insights campaign <id> [range] [breakdowns] - Campaign insights
 *   node src/index.js insights adset <id> [range] [breakdowns]    - Ad set insights
 *   node src/index.js insights ad <id> [range] [breakdowns]       - Ad insights
 *   node src/index.js insights async <id> [breakdowns] [range]    - Create async report
 *   node src/index.js insights report <reportRunId>                - Check async report
 *   node src/index.js targeting search <query> [type]  - Search targeting options
 *   node src/index.js targeting locations <query>      - Search locations
 *   node src/index.js targeting reach '<json>'         - Estimate reach
 *   node src/index.js ad-library search <terms> [countries] - Search active competitor ads
 *   node src/index.js audiences list                   - List custom audiences
 *   node src/index.js audiences create '<json>'        - Create custom audience
 *   node src/index.js audiences lookalike '<json>'     - Create lookalike audience
 *   node src/index.js pixels list                      - List pixels
 *   node src/index.js pixels stats <id> [timeRange]    - Pixel stats
 *   node src/index.js account                          - Account info
 *   node src/index.js sync                             - Sync all data to local cache
 *   node src/index.js doctor                           - Setup/readiness check
 *   node src/index.js strategy show|init|log "<note>"|context - Manage the local media-buying strategy
 *   node src/index.js draft-campaign '<json>'          - Save offline PAUSED campaign draft
 *   node src/index.js experiments list|create|get|results - Manage A/B experiments
 *   node src/index.js rules list|get|create|update|delete [--confirm "CONFIRM RULE <name>"] - Manage automated rules
 *   node src/index.js leads forms|get|lead              - Retrieve lead forms and leads
 */

const api = require("./api-client");
const { buildCampaignDraft, saveCampaignDraft } = require("./copilot");
const { readinessReport } = require("./readiness");
const { checkDailyBudgetLimit, writeGate } = require("./recipe-helpers");
const carousel = require("./carousel");
const fs = require("fs");
const path = require("path");

const CACHE_DIR = path.join(__dirname, "../data");
const BRAIN_DIR = path.join(__dirname, "../brain");
const STRATEGY_PATH = path.join(CACHE_DIR, "STRATEGY.md");
const STRATEGY_TEMPLATE_PATH = path.join(BRAIN_DIR, "STRATEGY-TEMPLATE.md");
const OFFER_CONTEXT_PATH = path.join(CACHE_DIR, "offer-context-local.md");
const OFFER_CONTEXT_TEMPLATE_PATH = path.join(BRAIN_DIR, "OFFER-CONTEXT.md");

function ensureCacheDir() {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

function writeCache(name, data) {
  ensureCacheDir();
  fs.writeFileSync(path.join(CACHE_DIR, `${name}.json`), JSON.stringify(data, null, 2));
}

function pp(data) {
  console.log(JSON.stringify(data, null, 2));
}

function strategyDate() {
  return new Date().toISOString().slice(0, 10);
}

function updateStrategyStamp(strategy, date) {
  const stamp = `Last updated: ${date}`;
  if (/^Last updated:.*$/m.test(strategy)) return strategy.replace(/^Last updated:.*$/m, stamp);
  return strategy.replace(/^# Strategy Template\n/m, `# Strategy Template\n\n${stamp}\n`);
}

function appendStrategyLog(strategy, note, date) {
  const heading = "## Kill and scale log";
  const headingIndex = strategy.indexOf(heading);
  if (headingIndex === -1) throw new Error("Strategy file is missing the Kill and scale log section");
  const nextHeadingIndex = strategy.indexOf("\n## ", headingIndex + heading.length);
  const insertionPoint = nextHeadingIndex === -1 ? strategy.length : nextHeadingIndex;
  const entry = `* ${date} [HOLD]: ${note}\n`;
  return `${strategy.slice(0, insertionPoint).replace(/\n*$/, "\n")}${entry}${strategy.slice(insertionPoint)}`;
}

function runStrategyCommand(subcommand, args) {
  switch (subcommand) {
    case "init":
      if (fs.existsSync(STRATEGY_PATH)) throw new Error(`Strategy already exists at ${STRATEGY_PATH}. Use strategy show or strategy log.`);
      ensureCacheDir();
      fs.copyFileSync(STRATEGY_TEMPLATE_PATH, STRATEGY_PATH);
      console.log(`Created strategy at ${STRATEGY_PATH}`);
      return;
    case "show":
      if (!fs.existsSync(STRATEGY_PATH)) throw new Error("No local strategy found. Run strategy init first.");
      console.log(fs.readFileSync(STRATEGY_PATH, "utf8"));
      return;
    case "log": {
      const note = args.join(" ").trim();
      if (!note) throw new Error("Usage: strategy log \"<note>\"");
      if (!fs.existsSync(STRATEGY_PATH)) throw new Error("No local strategy found. Run strategy init first.");
      const date = strategyDate();
      const strategy = fs.readFileSync(STRATEGY_PATH, "utf8");
      fs.writeFileSync(STRATEGY_PATH, updateStrategyStamp(appendStrategyLog(strategy, note, date), date));
      console.log(`Logged strategy note for ${date}.`);
      return;
    }
    case "context":
      if (fs.existsSync(OFFER_CONTEXT_PATH)) {
        console.log(fs.readFileSync(OFFER_CONTEXT_PATH, "utf8"));
      } else {
        console.log(`${fs.readFileSync(OFFER_CONTEXT_TEMPLATE_PATH, "utf8")}\n\nNote: fill data/offer-context-local.md with the account-specific offer context.`);
      }
      return;
    default:
      throw new Error("Usage: strategy show|init|log \"<note>\"|context");
  }
}

function checkBudget(input, action, usdKeys = []) {
  for (const key of ["daily_budget", "lifetime_budget"]) {
    if (input[key] !== undefined && input[key] !== null) {
      checkDailyBudgetLimit(input[key], action);
    }
  }
  for (const key of usdKeys) {
    if (input[key] !== undefined && input[key] !== null) {
      checkDailyBudgetLimit(Math.round(Number(input[key]) * 100), action);
    }
  }
}

function requireRuleConfirmation(args, name, action) {
  const expectedConfirmation = `CONFIRM RULE ${name}`;
  const confirmIndex = args.indexOf("--confirm");
  const confirmation = confirmIndex === -1 ? undefined : args[confirmIndex + 1];
  if (confirmation !== expectedConfirmation) {
    throw new Error(`Rule ${action} requires confirm: ${expectedConfirmation}`);
  }
}

function requireSpendConfirmation(args, action, id) {
  const expectedConfirmation = `CONFIRM ${action} ${id}`;
  const confirmIndex = args.indexOf("--confirm");
  const confirmation = confirmIndex === -1 ? undefined : args[confirmIndex + 1];
  if (confirmation !== expectedConfirmation) {
    throw new Error(`${action} requires confirm: ${expectedConfirmation}`);
  }
}

async function dashboard(timeRange = "last_30d") {
  console.log("=== Meta Ads Dashboard ===\n");

  const [account, insights, campaigns] = await Promise.all([
    api.getAccountInfo(),
    api.getAccountInsights(timeRange),
    api.listCampaigns(),
  ]);

  console.log(`Account: ${account.name} (${account.id})`);
  console.log(`Currency: ${account.currency} | Timezone: ${account.timezone_name}`);
  console.log(`Total Spent: ${account.amount_spent ? (account.amount_spent / 100).toFixed(2) : "N/A"}`);
  console.log(`Balance: ${account.balance ? (account.balance / 100).toFixed(2) : "N/A"}`);
  console.log();

  if (insights.data && insights.data[0]) {
    const i = insights.data[0];
    console.log("--- Performance Summary ---");
    console.log(`Spend: $${parseFloat(i.spend || 0).toFixed(2)}`);
    console.log(`Impressions: ${parseInt(i.impressions || 0).toLocaleString()}`);
    console.log(`Reach: ${parseInt(i.reach || 0).toLocaleString()}`);
    console.log(`Clicks: ${parseInt(i.clicks || 0).toLocaleString()}`);
    console.log(`CTR: ${parseFloat(i.ctr || 0).toFixed(2)}%`);
    console.log(`CPC: $${parseFloat(i.cpc || 0).toFixed(2)}`);
    console.log(`CPM: $${parseFloat(i.cpm || 0).toFixed(2)}`);
    console.log(`Frequency: ${parseFloat(i.frequency || 0).toFixed(2)}`);
    console.log();
  }

  if (campaigns.data) {
    const active = campaigns.data.filter(c => c.status === "ACTIVE");
    const paused = campaigns.data.filter(c => c.status === "PAUSED");
    console.log(`--- Campaigns: ${campaigns.data.length} total (${active.length} active, ${paused.length} paused) ---`);
    for (const c of campaigns.data.slice(0, 10)) {
      const budget = c.daily_budget ? `$${(c.daily_budget / 100).toFixed(2)}/day` : c.lifetime_budget ? `$${(c.lifetime_budget / 100).toFixed(2)} lifetime` : "no budget";
      console.log(`  [${c.status}] ${c.name} — ${c.objective} — ${budget}`);
    }
  }

  // Cache for MC dashboard
  writeCache("dashboard", { account, insights: insights.data, campaigns: campaigns.data, fetchedAt: new Date().toISOString() });
}

async function syncAll() {
  console.log("Syncing Meta Ads data...");
  const [campaigns, adsets, audiences, pixels, insights, account] = await Promise.all([
    api.listCampaigns(),
    api.listAdSets(),
    api.listCustomAudiences(),
    api.listPixels(),
    api.getAccountInsights(),
    api.getAccountInfo(),
  ]);

  writeCache("campaigns", campaigns.data || []);
  writeCache("adsets", adsets.data || []);
  writeCache("audiences", audiences.data || []);
  writeCache("pixels", pixels.data || []);
  writeCache("insights", insights.data || []);
  writeCache("account", account);
  writeCache("last-sync", { timestamp: new Date().toISOString() });

  console.log(`Synced: ${(campaigns.data || []).length} campaigns, ${(adsets.data || []).length} ad sets, ${(audiences.data || []).length} audiences, ${(pixels.data || []).length} pixels`);
}

async function main() {
  const args = process.argv.slice(2);
  const dryRunIndex = args.indexOf("--dry-run");
  const isDryRun = dryRunIndex !== -1;
  if (dryRunIndex !== -1) {
    args.splice(dryRunIndex, 1);
    api.setDryRun(true);
  }
  const command = args[0] || "dashboard";
  const sub = args[1];

  try {
    switch (command) {
      case "dashboard":
        await dashboard(sub || "last_30d");
        break;

      case "campaigns":
        switch (sub) {
          case "list":
            pp(await api.listCampaigns());
            break;
          case "get":
            if (!args[2]) { console.error("Usage: campaigns get <id>"); process.exit(1); }
            pp(await api.getCampaign(args[2]));
            break;
          case "create":
            if (!args[2]) { console.error("Usage: campaigns create '<json>'"); process.exit(1); }
            writeGate("campaigns create");
            {
              const input = JSON.parse(args[2]);
              checkBudget(input, "campaigns create", ["dailyBudget", "lifetimeBudget"]);
              pp(await api.createCampaign(input));
            }
            break;
          case "pause":
            if (!args[2]) { console.error("Usage: campaigns pause <id>"); process.exit(1); }
            if (!isDryRun) requireSpendConfirmation(args, "PAUSE", args[2]);
            writeGate("campaigns pause");
            pp(await api.pauseCampaign(args[2]));
            break;
          case "activate":
            if (!args[2]) { console.error("Usage: campaigns activate <id>"); process.exit(1); }
            if (!isDryRun) requireSpendConfirmation(args, "ACTIVATE", args[2]);
            writeGate("campaigns activate");
            pp(await api.activateCampaign(args[2]));
            break;
          case "update":
            if (!args[2] || !args[3]) { console.error("Usage: campaigns update <id> '<json>'"); process.exit(1); }
            writeGate("campaigns update");
            {
              const input = JSON.parse(args[3]);
              checkBudget(input, "campaigns update");
              pp(await api.updateCampaign(args[2], input));
            }
            break;
          case "budget":
            if (!args[2] || !args[3]) { console.error("Usage: campaigns budget <id> <cents>"); process.exit(1); }
            if (!isDryRun) requireSpendConfirmation(args, "BUDGET", args[2]);
            pp(await api.updateBudget(args[2], args[3], { dryRun: false }));
            break;
          default:
            pp(await api.listCampaigns());
        }
        break;

      case "adsets":
        switch (sub) {
          case "list":
            pp(await api.listAdSets(args[2] || null));
            break;
          case "create":
            if (!args[2]) { console.error("Usage: adsets create '<json>'"); process.exit(1); }
            writeGate("adsets create");
            {
              const input = JSON.parse(args[2]);
              checkBudget(input, "adsets create", ["dailyBudget", "lifetimeBudget"]);
              pp(await api.createAdSet(input));
            }
            break;
          case "budget":
            if (!args[2] || !args[3]) { console.error("Usage: adsets budget <id> <cents>"); process.exit(1); }
            if (!isDryRun) requireSpendConfirmation(args, "BUDGET", args[2]);
            pp(await api.updateBudget(args[2], args[3], { dryRun: false }));
            break;
          default:
            pp(await api.listAdSets());
        }
        break;

      case "ads":
        switch (sub) {
          case "list":
            pp(await api.listAds(args[2] || null));
            break;
          case "create":
            if (!args[2]) { console.error("Usage: ads create '<json>'"); process.exit(1); }
            writeGate("ads create");
            pp(await api.createAd(JSON.parse(args[2])));
            break;
          default:
            pp(await api.listAds());
        }
        break;

      case "creatives":
        switch (sub) {
          case "create":
            if (!args[2]) { console.error("Usage: creatives create '<json>'"); process.exit(1); }
            writeGate("creatives create");
            pp(await api.createAdCreative(JSON.parse(args[2])));
            break;
          case "carousel": {
            if (args[2] === "--example") {
              pp(carousel.carouselExampleSpec());
              break;
            }
            if (!args[2]) { console.error("Usage: creatives carousel <spec.json|'<json>'> [--dry-run]"); process.exit(1); }
            const loaded = carousel.loadCarouselSpec(args[2]);
            const { spec, warnings } = carousel.validateCarouselSpec(loaded);
            if (!isDryRun) writeGate("creatives carousel");
            const result = await api.createCarouselCreative(spec, isDryRun);
            result.warnings = warnings;
            warnings.forEach((warning) => console.error(`Warning: ${warning}`));
            pp(result);
            break;
          }
          default:
            console.error("Usage: creatives create '<json>' | creatives carousel <spec.json|'<json>'> [--dry-run] | creatives carousel --example");
            process.exit(1);
        }
        break;

      case "images":
        switch (sub) {
          case "upload": {
            if (!args[2]) { console.error("Usage: images upload <path|url> [name]"); process.exit(1); }
            const source = args[2];
            const input = /^https?:\/\//i.test(source)
              ? { url: source, name: args[3] }
              : { filePath: source, name: args[3] };
            pp(await api.uploadAdImage(input));
            break;
          }
          case "list":
          default:
            pp(await api.listAdImages());
        }
        break;

      case "insights":
        switch (sub) {
          case "campaign":
            if (!args[2]) { console.error("Usage: insights campaign <id> [range]"); process.exit(1); }
            pp(await api.getCampaignInsights(args[2], args[3] || "last_30d", args[4] || null));
            break;
          case "adset":
            if (!args[2]) { console.error("Usage: insights adset <id> [range]"); process.exit(1); }
            pp(await api.getAdSetInsights(args[2], args[3] || "last_30d", args[4] || null));
            break;
          case "ad":
            if (!args[2]) { console.error("Usage: insights ad <id> [range]"); process.exit(1); }
            pp(await api.getAdInsights(args[2], args[3] || "last_30d", args[4] || null));
            break;
          case "async":
            if (!args[2]) { console.error("Usage: insights async <objectId> [breakdowns] [range]"); process.exit(1); }
            pp(await api.createAsyncReport({ objectId: args[2], breakdowns: args[3] || undefined, timeRange: args[4] || "last_30d" }));
            break;
          case "report":
            if (!args[2]) { console.error("Usage: insights report <reportRunId>"); process.exit(1); }
            pp(await api.getAsyncReportStatus(args[2]));
            break;
          default:
            pp(await api.getAccountInsights(sub || "last_30d"));
        }
        break;

      case "targeting":
        switch (sub) {
          case "search":
            if (!args[2]) { console.error("Usage: targeting search <query> [type]"); process.exit(1); }
            pp(await api.searchTargeting({ q: args[2], type: args[3] || "adinterest" }));
            break;
          case "locations":
            if (!args[2]) { console.error("Usage: targeting locations <query>"); process.exit(1); }
            pp(await api.searchLocations({ q: args[2] }));
            break;
          case "reach":
            if (!args[2]) { console.error("Usage: targeting reach '<targetingSpecJson>'"); process.exit(1); }
            pp(await api.getReachEstimate({ targetingSpec: JSON.parse(args[2]) }));
            break;
          default:
            console.error("Usage: targeting search <query> [type] | targeting locations <query> | targeting reach '<targetingSpecJson>'");
            process.exit(1);
        }
        break;

      case "ad-library":
        if (sub !== "search" || !args[2] || !args[2].trim()) {
          console.error("Usage: ad-library search <terms> [countries]");
          process.exit(1);
        }
        pp(await api.searchAdLibrary({
          searchTerms: args[2],
          adReachedCountries: (args[3] || "US").split(",").map((country) => country.trim()).filter(Boolean),
        }));
        break;

      case "audiences":
        switch (sub) {
          case "list":
            pp(await api.listCustomAudiences());
            break;
          case "create":
            if (!args[2]) { console.error("Usage: audiences create '<json>'"); process.exit(1); }
            writeGate("audiences create");
            pp(await api.createCustomAudience(JSON.parse(args[2])));
            break;
          case "lookalike":
            if (!args[2]) { console.error("Usage: audiences lookalike '<json>'"); process.exit(1); }
            writeGate("audiences lookalike");
            pp(await api.createLookalikeAudience(JSON.parse(args[2])));
            break;
          default:
            pp(await api.listCustomAudiences());
        }
        break;

      case "pixels":
        switch (sub) {
          case "list":
            pp(await api.listPixels());
            break;
          case "stats":
            if (!args[2]) { console.error("Usage: pixels stats <id> [range]"); process.exit(1); }
            pp(await api.getPixelStats(args[2], args[3] || "last_30d"));
            break;
          default:
            pp(await api.listPixels());
        }
        break;

      case "experiments":
        switch (sub) {
          case "list":
            pp(await api.listExperiments());
            break;
          case "get":
            if (!args[2]) { console.error("Usage: experiments get <id>"); process.exit(1); }
            pp(await api.getExperiment(args[2]));
            break;
          case "results":
            if (!args[2]) { console.error("Usage: experiments results <id>"); process.exit(1); }
            pp(await api.getExperimentResults(args[2]));
            break;
          case "create":
            if (!args[2]) { console.error("Usage: experiments create '<json>'"); process.exit(1); }
            pp(await api.createExperiment(JSON.parse(args[2])));
            break;
          default:
            pp(await api.listExperiments());
        }
        break;

      case "rules":
        switch (sub) {
          case "list":
            pp(await api.listRules());
            break;
          case "get":
            if (!args[2]) { console.error("Usage: rules get <id>"); process.exit(1); }
            pp(await api.getRule(args[2]));
            break;
          case "create":
            if (!args[2]) { console.error("Usage: rules create '<json>'"); process.exit(1); }
            {
              const input = JSON.parse(args[2]);
              if (!isDryRun) requireRuleConfirmation(args, input.name, "creation");
              pp(await api.createRule(input));
            }
            break;
          case "update":
            if (!args[2] || !args[3]) { console.error("Usage: rules update <id> '<json>'"); process.exit(1); }
            if (!isDryRun) requireRuleConfirmation(args, args[2], "update");
            pp(await api.updateRule(args[2], JSON.parse(args[3])));
            break;
          case "delete":
            if (!args[2]) { console.error("Usage: rules delete <id>"); process.exit(1); }
            if (!isDryRun) requireRuleConfirmation(args, args[2], "deletion");
            pp(await api.deleteRule(args[2]));
            break;
          default:
            pp(await api.listRules());
        }
        break;

      case "leads":
        switch (sub) {
          case "forms":
            if (!args[2]) { console.error("Usage: leads forms <pageId>"); process.exit(1); }
            pp(await api.listLeadForms(args[2]));
            break;
          case "get":
            if (!args[2]) { console.error("Usage: leads get <formId>"); process.exit(1); }
            pp(await api.getFormLeads(args[2]));
            break;
          case "lead":
            if (!args[2]) { console.error("Usage: leads lead <leadId>"); process.exit(1); }
            pp(await api.getLead(args[2]));
            break;
          default:
            console.error("Usage: leads forms <pageId> | leads get <formId> | leads lead <leadId>");
            process.exit(1);
        }
        break;

      case "account":
        pp(await api.getAccountInfo());
        break;

      case "sync":
        await syncAll();
        break;

      case "doctor":
      case "setup-status":
        pp(await readinessReport());
        break;

      case "strategy":
        runStrategyCommand(sub, args.slice(2));
        break;

      case "draft-campaign": {
        if (!sub) { console.error("Usage: draft-campaign '<json>'"); process.exit(1); }
        const draft = buildCampaignDraft(JSON.parse(sub));
        const filePath = saveCampaignDraft(draft);
        pp({ status: "draft_saved", filePath, draft });
        break;
      }

      default:
        console.error(`Unknown command: ${command}`);
        console.log("Commands: dashboard, campaigns, adsets, ads, creatives, images, insights, targeting, ad-library, audiences, pixels, experiments, rules, leads, account, sync, doctor, strategy, draft-campaign");
        process.exit(1);
    }
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

main();
