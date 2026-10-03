#!/usr/bin/env bash
# Meta Ads agent installer.
#
# 1. npm install in this folder.
# 2. Looks for a dashboard to put the Mission Control pages into, in this order:
#      --mission-control <path>, $ALLSORTED_MISSION_CONTROL, ../mission-control,
#      ~/allsorted*/mission-control, and any
#      Next.js app two levels under your home folder that has an app/app folder
#      (the dashboards students build).
# 3. Copies mission-control/app/** into it WITHOUT overwriting anything you have,
#    adds a nav entry for the dashboard page when nav-data.ts exists and has
#    none, and writes an install marker listing the files it added.
# 4. Runs the setup check (doctor) and prints it.
# 5. Registers the weekly self-update (ALLSORTED_SKIP_UPDATES=1 skips it).
# 6. Opens the page in your browser when a dev server is already running.
#
# It never reads or writes .env, config/config.json or data/.
# Safe to run twice: a second run adds nothing and overwrites nothing.
#
# Options:
#   --mission-control <path>   use this dashboard
#   --no-open                  do not open a browser
#   --port <n>                 the dashboard's port (default 3000)
#   --home <path>              search this folder instead of $HOME (tests)
set -euo pipefail

AGENT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PAGES_DIR="$AGENT_DIR/mission-control/app"
MARKER_NAME=".allsorted-meta-ads-install.json"

MC_ARG=""
OPEN=1
PORT="${META_ADS_MC_PORT:-3000}"
SEARCH_HOME="$HOME"
while [ $# -gt 0 ]; do
  case "$1" in
    --mission-control) MC_ARG="${2:-}"; shift 2 ;;
    --no-open) OPEN=0; shift ;;
    --port) PORT="${2:-3000}"; shift 2 ;;
    --home) SEARCH_HOME="${2:-$HOME}"; shift 2 ;;
    -h|--help) sed -n '2,25p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $1 (see --help)"; exit 1 ;;
  esac
done

say() { printf '%s\n' "$*"; }

# ---- 1. dependencies ------------------------------------------------------
if ! command -v node >/dev/null 2>&1; then
  say "Node.js 20 or newer is required. Install it, then run this again."
  exit 1
fi
if ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 20 ? 0 : 1)'; then
  say "Node.js 20 or newer is required. Found $(node -v)."
  exit 1
fi
say "Meta Ads agent: $AGENT_DIR"
if [ "${META_ADS_SKIP_NPM:-0}" = "1" ]; then
  say "npm install skipped (META_ADS_SKIP_NPM=1)."
else
  (cd "$AGENT_DIR" && npm install --no-audit --no-fund --loglevel=error)
  say "Dependencies installed."
fi

# ---- 2. find a dashboard ----------------------------------------------------
is_dashboard() {
  # A Next.js app with an app/app folder: the shape every Mission Control shares.
  [ -d "$1" ] && [ -f "$1/package.json" ] && [ -d "$1/app/app" ] && grep -q '"next"' "$1/package.json" 2>/dev/null
}

MC_DIR=""
how=""
if [ -n "$MC_ARG" ]; then
  if is_dashboard "$MC_ARG"; then MC_DIR="$(cd "$MC_ARG" && pwd)"; how="--mission-control"; else say "The folder given with --mission-control is not a Next.js dashboard (needs package.json with next and an app/app folder): $MC_ARG"; exit 1; fi
fi
if [ -z "$MC_DIR" ] && [ -n "${ALLSORTED_MISSION_CONTROL:-}" ] && is_dashboard "$ALLSORTED_MISSION_CONTROL"; then
  MC_DIR="$(cd "$ALLSORTED_MISSION_CONTROL" && pwd)"; how="ALLSORTED_MISSION_CONTROL"
fi
if [ -z "$MC_DIR" ] && is_dashboard "$AGENT_DIR/../mission-control"; then
  MC_DIR="$(cd "$AGENT_DIR/../mission-control" && pwd)"; how="next to the agent folder"
fi
if [ -z "$MC_DIR" ]; then
  for candidate in "$SEARCH_HOME"/allsorted*/mission-control; do
    if is_dashboard "$candidate"; then MC_DIR="$(cd "$candidate" && pwd)"; how="~/allsorted*/mission-control"; break; fi
  done
fi
if [ -z "$MC_DIR" ]; then
  # Two levels under the home folder: ~/x/dashboard and ~/x/y/dashboard, skipping hidden folders and node_modules.
  while IFS= read -r candidate; do
    [ -n "$candidate" ] || continue
    if is_dashboard "$candidate"; then MC_DIR="$candidate"; how="found under $SEARCH_HOME"; break; fi
  done < <(find "$SEARCH_HOME" -mindepth 3 -maxdepth 4 -type d -name app -path "*/app/app" -not -path "*/node_modules/*" -not -path "*/.*" 2>/dev/null | sed 's#/app/app$##' | sort)
fi

# ---- 3. copy the pages, never overwriting -----------------------------------
PAGE_URL=""
if [ -n "$MC_DIR" ]; then
  say "Dashboard: $MC_DIR ($how)"
  added=()
  skipped=()
  while IFS= read -r source; do
    rel="${source#"$PAGES_DIR"/}"
    target="$MC_DIR/app/$rel"
    if [ -e "$target" ] || [ -L "$target" ]; then
      skipped+=("app/$rel")
      say "  kept    app/$rel (already yours, left untouched)"
    else
      mkdir -p "$(dirname "$target")"
      cp "$source" "$target"
      added+=("app/$rel")
      say "  added   app/$rel"
    fi
  done < <(find "$PAGES_DIR" -type f | sort)

  # The page lands at /app/meta-ads when that page is ours (or was added now);
  # a dashboard that already had its own /app/meta-ads keeps it and gets the
  # owner dashboard at /app/meta-ads/dashboard.
  if grep -q 'components/Dashboard' "$MC_DIR/app/app/meta-ads/page.tsx" 2>/dev/null; then
    PAGE_PATH="/app/meta-ads"
  else
    PAGE_PATH="/app/meta-ads/dashboard"
    say "  note    your dashboard already had its own app/app/meta-ads/page.tsx; the owner dashboard is at /app/meta-ads/dashboard"
  fi
  PAGE_URL="http://localhost:$PORT$PAGE_PATH"
  NAV_LINE="  { name: \"Meta Ads\", href: \"$PAGE_PATH\" },"

  NAV_FILE="$MC_DIR/app/app/_nav/nav-data.ts"
  nav_status="no nav-data.ts; add a link to $PAGE_PATH to your own navigation"
  insert_nav() {
    # $1 = anchor text; the nav line goes on the line after it.
    node -e '
      const fs = require("fs"); const [file, anchor, line] = process.argv.slice(1);
      const text = fs.readFileSync(file, "utf8");
      const index = text.indexOf(anchor);
      if (index === -1) process.exit(2);
      const end = index + anchor.length;
      fs.writeFileSync(file, text.slice(0, end) + "\n" + line + text.slice(end));
    ' "$NAV_FILE" "$1" "$NAV_LINE"
  }
  if [ -f "$NAV_FILE" ]; then
    if grep -q 'meta-ads' "$NAV_FILE"; then
      nav_status="already present"
      say "  kept    app/app/_nav/nav-data.ts (already links meta-ads)"
    elif grep -q 'href: "/app/carousel-builder" },' "$NAV_FILE" && insert_nav '  { name: "Carousel Builder", href: "/app/carousel-builder" },'; then
      nav_status="added after Carousel Builder"; added+=("app/app/_nav/nav-data.ts (one line)"); say "  nav     added a Meta Ads entry to app/app/_nav/nav-data.ts"
    elif grep -q 'NAV_ENTRIES: NavEntry\[\] = \[' "$NAV_FILE" && insert_nav 'NAV_ENTRIES: NavEntry[] = ['; then
      nav_status="added at the top of NAV_ENTRIES"; added+=("app/app/_nav/nav-data.ts (one line)"); say "  nav     added a Meta Ads entry to app/app/_nav/nav-data.ts"
    else
      nav_status="could not add automatically; add $NAV_LINE to nav-data.ts yourself"
      say "  nav     $nav_status"
    fi
  else
    say "  nav     $nav_status"
  fi

  MARKER="$MC_DIR/$MARKER_NAME"
  node -e '
    const fs = require("fs");
    const [file, agent, mc, added, skipped, nav] = process.argv.slice(1);
    const existing = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : { name: "meta-ads", files: [] };
    const known = new Set((existing.files || []).map((entry) => entry.relative));
    const files = [...(existing.files || [])];
    for (const relative of added.split("\n").filter(Boolean)) if (!known.has(relative)) files.push({ relative, backup: null, created: true });
    const marker = { ...existing, name: "meta-ads", version: JSON.parse(fs.readFileSync(agent + "/package.json", "utf8")).version, agentDir: agent, missionControl: mc, installedAt: existing.installedAt || new Date().toISOString(), lastRunAt: new Date().toISOString(), files, skippedLastRun: skipped.split("\n").filter(Boolean), nav };
    fs.writeFileSync(file, JSON.stringify(marker, null, 2) + "\n");
  ' "$MARKER" "$AGENT_DIR" "$MC_DIR" "$(printf '%s\n' "${added[@]:-}")" "$(printf '%s\n' "${skipped[@]:-}")" "$nav_status"
  say "  marker  $MARKER (${#added[@]} added, ${#skipped[@]} kept)"
else
  say "No dashboard found to put the pages into (looked for --mission-control, ALLSORTED_MISSION_CONTROL, ../mission-control, ~/allsorted*/mission-control and Next.js apps under $SEARCH_HOME)."
  say "The agent works without one. To get the owner dashboard, install All Sorted Mission Control and run this installer again, or pass --mission-control <path>."
fi

# ---- 4. doctor ----------------------------------------------------------------
say ""
say "Setup check:"
(cd "$AGENT_DIR" && node src/index.js doctor) || true

# ---- 5. weekly self-update ------------------------------------------------------
# On by default, one line turns it off. It fast-forwards this clone from its
# origin, never touches .env, config or data, backs up first and rolls back
# when the self-test fails.
say ""
if [ ! -f "$AGENT_DIR/scripts/self-update.js" ]; then
  say "Weekly updates: scripts/self-update.js is not in this copy, nothing scheduled."
elif [ "${ALLSORTED_SKIP_UPDATES:-0}" = "1" ]; then
  say "Weekly updates not scheduled (ALLSORTED_SKIP_UPDATES=1). Later: node \"$AGENT_DIR/scripts/self-update.js\" --register"
else
  node "$AGENT_DIR/scripts/self-update.js" --register || say "Weekly updates could not be scheduled. Try later: node \"$AGENT_DIR/scripts/self-update.js\" --register"
fi

# ---- 6. open the page ---------------------------------------------------------
say ""
if [ -n "$PAGE_URL" ]; then
  if [ "$OPEN" = "1" ] && curl -sf -o /dev/null --max-time 3 "http://localhost:$PORT/api/meta-ads/freshness" 2>/dev/null; then
    say "Opening $PAGE_URL"
    if command -v open >/dev/null 2>&1; then open "$PAGE_URL"; elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$PAGE_URL"; else say "Open it yourself: $PAGE_URL"; fi
  else
    say "Dashboard page: $PAGE_URL"
    say "Start Mission Control first if it is not running:  cd \"$MC_DIR\" && npm run dev"
    say "Then open $PAGE_URL"
  fi
fi
say ""
say "Next: add your Meta credentials to $AGENT_DIR/.env (see docs/SETUP.md), run node src/index.js doctor, then press Refresh on the dashboard."
say "Live writes stay off until you set META_ADS_WRITES_ENABLED=true yourself; every budget write is capped by META_ADS_MAX_DAILY_BUDGET_CENTS."
