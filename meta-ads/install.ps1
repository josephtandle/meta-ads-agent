# Meta Ads agent installer for Windows (PowerShell). Same steps as install.sh:
# npm install, find a dashboard, copy the Mission Control pages without
# overwriting anything, add a nav entry once, write an install marker, run the
# setup check, register the weekly self-update, open the page when a dev
# server answers. It never reads or writes .env, config/config.json or data/.
# Safe to run twice.
#
#   .\install.ps1 [-MissionControl <path>] [-NoOpen] [-Port 3000] [-Home <path>]
param(
  [string]$MissionControl = "",
  [switch]$NoOpen,
  [int]$Port = 3000,
  [string]$Home = $env:USERPROFILE
)
$ErrorActionPreference = "Stop"
$AgentDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$PagesDir = Join-Path $AgentDir "mission-control\app"

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { Write-Host "Node.js 20 or newer is required. Install it, then run this again."; exit 1 }
$major = [int]((& $node.Source -p 'process.versions.node') -split '\.')[0]
if ($major -lt 20) { Write-Host "Node.js 20 or newer is required. Found $(& $node.Source -v)."; exit 1 }
Write-Host "Meta Ads agent: $AgentDir"
if ($env:META_ADS_SKIP_NPM -eq "1") { Write-Host "npm install skipped (META_ADS_SKIP_NPM=1)." }
else { Push-Location $AgentDir; try { npm install --no-audit --no-fund --loglevel=error } finally { Pop-Location }; Write-Host "Dependencies installed." }

function Test-Dashboard([string]$dir) {
  if (-not $dir) { return $false }
  return (Test-Path (Join-Path $dir "package.json")) -and (Test-Path (Join-Path $dir "app\app")) -and ((Get-Content (Join-Path $dir "package.json") -Raw) -match '"next"')
}

$McDir = ""; $How = ""
if ($MissionControl) { if (Test-Dashboard $MissionControl) { $McDir = (Resolve-Path $MissionControl).Path; $How = "-MissionControl" } else { Write-Host "Not a Next.js dashboard: $MissionControl"; exit 1 } }
if (-not $McDir -and $env:ALLSORTED_MISSION_CONTROL -and (Test-Dashboard $env:ALLSORTED_MISSION_CONTROL)) { $McDir = (Resolve-Path $env:ALLSORTED_MISSION_CONTROL).Path; $How = "ALLSORTED_MISSION_CONTROL" }
if (-not $McDir -and (Test-Dashboard (Join-Path $AgentDir "..\mission-control"))) { $McDir = (Resolve-Path (Join-Path $AgentDir "..\mission-control")).Path; $How = "next to the agent folder" }
if (-not $McDir) { foreach ($c in (Get-ChildItem -Path $Home -Directory -Filter "allsorted*" -ErrorAction SilentlyContinue)) { $p = Join-Path $c.FullName "mission-control"; if (Test-Dashboard $p) { $McDir = $p; $How = "~/allsorted*/mission-control"; break } } }
if (-not $McDir) {
  $candidates = Get-ChildItem -Path $Home -Directory -Depth 2 -ErrorAction SilentlyContinue | Where-Object { $_.Name -notlike ".*" -and $_.FullName -notmatch "node_modules" } | Sort-Object FullName
  foreach ($c in $candidates) { if (Test-Dashboard $c.FullName) { $McDir = $c.FullName; $How = "found under $Home"; break } }
}

$PageUrl = ""
if ($McDir) {
  Write-Host "Dashboard: $McDir ($How)"
  $added = @(); $skipped = @()
  foreach ($file in (Get-ChildItem -Path $PagesDir -File -Recurse | Sort-Object FullName)) {
    $rel = $file.FullName.Substring($PagesDir.Length + 1)
    $target = Join-Path (Join-Path $McDir "app") $rel
    if (Test-Path $target) { $skipped += "app/$($rel -replace '\\','/')"; Write-Host "  kept    app/$($rel -replace '\\','/') (already yours, left untouched)" }
    else { New-Item -ItemType Directory -Force -Path (Split-Path $target) | Out-Null; Copy-Item $file.FullName $target; $added += "app/$($rel -replace '\\','/')"; Write-Host "  added   app/$($rel -replace '\\','/')" }
  }
  $pageFile = Join-Path $McDir "app\app\meta-ads\page.tsx"
  if ((Test-Path $pageFile) -and ((Get-Content $pageFile -Raw) -match "components/Dashboard")) { $PagePath = "/app/meta-ads" }
  else { $PagePath = "/app/meta-ads/dashboard"; Write-Host "  note    your dashboard already had its own app/app/meta-ads/page.tsx; the owner dashboard is at /app/meta-ads/dashboard" }
  $PageUrl = "http://localhost:$Port$PagePath"
  $NavLine = "  { name: `"Meta Ads`", href: `"$PagePath`" },"
  $navFile = Join-Path $McDir "app\app\_nav\nav-data.ts"
  $navStatus = "no nav-data.ts; add a link to $PagePath to your own navigation"
  if (Test-Path $navFile) {
    $nav = Get-Content $navFile -Raw
    if ($nav -match "meta-ads") { $navStatus = "already present"; Write-Host "  kept    app/app/_nav/nav-data.ts (already links meta-ads)" }
    else {
      $anchor = '  { name: "Carousel Builder", href: "/app/carousel-builder" },'
      if ($nav.Contains($anchor)) { $nav = $nav.Replace($anchor, "$anchor`n$NavLine"); $navStatus = "added after Carousel Builder" }
      elseif ($nav.Contains("NAV_ENTRIES: NavEntry[] = [")) { $nav = $nav.Replace("NAV_ENTRIES: NavEntry[] = [", "NAV_ENTRIES: NavEntry[] = [`n$NavLine"); $navStatus = "added at the top of NAV_ENTRIES" }
      else { $navStatus = "nav-data.ts has no NAV_ENTRIES list; add a link to $PagePath yourself" }
      if ($navStatus -like "added*") { [System.IO.File]::WriteAllText($navFile, $nav); $added += "app/app/_nav/nav-data.ts (one line)"; Write-Host "  nav     added a Meta Ads entry to app/app/_nav/nav-data.ts" }
    }
  }
  $marker = Join-Path $McDir ".allsorted-meta-ads-install.json"
  $existing = if (Test-Path $marker) { Get-Content $marker -Raw | ConvertFrom-Json } else { $null }
  $files = @(); if ($existing -and $existing.files) { $files = @($existing.files) }
  $known = @($files | ForEach-Object { $_.relative })
  foreach ($rel in $added) { if ($known -notcontains $rel) { $files += [pscustomobject]@{ relative = $rel; backup = $null; created = $true } } }
  $version = (Get-Content (Join-Path $AgentDir "package.json") -Raw | ConvertFrom-Json).version
  $out = [ordered]@{ name = "meta-ads"; version = $version; agentDir = $AgentDir; missionControl = $McDir; installedAt = $(if ($existing -and $existing.installedAt) { $existing.installedAt } else { (Get-Date).ToUniversalTime().ToString("o") }); lastRunAt = (Get-Date).ToUniversalTime().ToString("o"); files = $files; skippedLastRun = $skipped; nav = $navStatus }
  $out | ConvertTo-Json -Depth 5 | Set-Content $marker
  Write-Host "  marker  $marker ($($added.Count) added, $($skipped.Count) kept)"
} else {
  Write-Host "No dashboard found to put the pages into. The agent works without one; install All Sorted Mission Control and run this installer again, or pass -MissionControl <path>."
}

Write-Host ""; Write-Host "Setup check:"
Push-Location $AgentDir; try { node src/index.js doctor } catch { } finally { Pop-Location }

# Weekly self-update: on by default, one line turns it off. It fast-forwards
# this clone from its origin, never touches .env, config or data, backs up
# first and rolls back when the self-test fails.
Write-Host ""
$selfUpdate = Join-Path $AgentDir "scripts\self-update.js"
if (-not (Test-Path $selfUpdate)) { Write-Host "Weekly updates: scripts/self-update.js is not in this copy, nothing scheduled." }
elseif ($env:ALLSORTED_SKIP_UPDATES -eq "1") { Write-Host "Weekly updates not scheduled (ALLSORTED_SKIP_UPDATES=1). Later: node `"$selfUpdate`" --register" }
else {
  & $node.Source $selfUpdate --register
  if ($LASTEXITCODE -ne 0) { Write-Host "Weekly updates could not be scheduled. Try later: node `"$selfUpdate`" --register" }
}

Write-Host ""
if ($PageUrl) {
  $up = $false
  if (-not $NoOpen) { try { $null = Invoke-WebRequest -Uri "http://localhost:$Port/api/meta-ads/freshness" -TimeoutSec 3 -UseBasicParsing; $up = $true } catch { $up = $false } }
  if ($up) { Write-Host "Opening $PageUrl"; Start-Process $PageUrl }
  else { Write-Host "Dashboard page: $PageUrl"; Write-Host "Start Mission Control first if it is not running:  cd `"$McDir`"; npm run dev"; Write-Host "Then open $PageUrl" }
}
Write-Host ""
Write-Host "Next: add your Meta credentials to $AgentDir\.env (see docs\SETUP.md), run node src/index.js doctor, then press Refresh on the dashboard."
Write-Host "Live writes stay off until you set META_ADS_WRITES_ENABLED=true yourself; every budget write is capped by META_ADS_MAX_DAILY_BUDGET_CENTS."
