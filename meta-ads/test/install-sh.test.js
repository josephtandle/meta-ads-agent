// install.sh against a temp home that holds a fake student dashboard: files
// added, nothing overwritten (a pre-seeded conflicting file stays byte-for-
// byte), the nav entry added once, a second run is a no-op, no browser opened
// (--no-open, and the --port points nowhere). npm install is skipped
// (META_ADS_SKIP_NPM=1). Skipped on Windows and when bash is missing.
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const agentRoot = path.join(__dirname, "..");
const installer = path.join(agentRoot, "install.sh");

function listFiles(dir) {
  const out = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.push(path.relative(dir, full));
    }
  };
  walk(dir);
  return out.sort();
}

function run() {
  if (process.platform === "win32" || !fs.existsSync(installer) || spawnSync("bash", ["--version"]).status !== 0) {
    console.log("install-sh.test.js skipped (no bash or installer not present)");
    return;
  }
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "meta-ads-install-home-"));
  try {
    // A student's dashboard, two levels under the home folder, with its own nav file.
    const dashboard = path.join(home, "projects", "my-dashboard");
    fs.mkdirSync(path.join(dashboard, "app", "app", "_nav"), { recursive: true });
    fs.mkdirSync(path.join(dashboard, "app", "api"), { recursive: true });
    fs.writeFileSync(path.join(dashboard, "package.json"), JSON.stringify({ name: "my-dashboard", dependencies: { next: "15.0.0", react: "19.0.0" } }));
    const navFile = path.join(dashboard, "app", "app", "_nav", "nav-data.ts");
    fs.writeFileSync(navFile, 'export const NAV_ENTRIES: NavEntry[] = [\n  { name: "Task Board", href: "/app/tasks" },\n  { name: "Carousel Builder", href: "/app/carousel-builder" },\n];\n');
    // A decoy that must not be picked: a Next app without app/app.
    fs.mkdirSync(path.join(home, "projects", "not-a-dashboard", "app"), { recursive: true });
    fs.writeFileSync(path.join(home, "projects", "not-a-dashboard", "package.json"), JSON.stringify({ dependencies: { next: "15.0.0" } }));
    // Pre-seed one conflicting file: the student already has their own ads table.
    const conflict = path.join(dashboard, "app", "app", "meta-ads", "components", "AdsTable.tsx");
    fs.mkdirSync(path.dirname(conflict), { recursive: true });
    const conflictBody = "// the student's own table; must survive the install untouched\nexport function AdsTable() { return null; }\n";
    fs.writeFileSync(conflict, conflictBody);

    const shipped = listFiles(path.join(agentRoot, "mission-control", "app"));
    assert.ok(shipped.includes(path.join("app", "meta-ads", "page.tsx")), "the agent ships the page");
    assert.ok(shipped.includes(path.join("api", "meta-ads", "_agent.ts")), "the agent ships the routes");

    const env = { ...process.env, HOME: home, META_ADS_SKIP_NPM: "1", ALLSORTED_SKIP_UPDATES: "1", BROWSER: "none" };
    const runInstaller = () => spawnSync("bash", [installer, "--no-open", "--home", home, "--port", "3999"], { encoding: "utf8", env, cwd: home });

    const first = runInstaller();
    assert.strictEqual(first.status, 0, `${first.stdout}\n${first.stderr}`);
    assert.match(first.stdout, /Dashboard: .*my-dashboard \(found under/);
    assert.match(first.stdout, /added {3}app\/app\/meta-ads\/page\.tsx/);
    assert.match(first.stdout, /added {3}app\/api\/meta-ads\/_agent\.ts/);
    assert.match(first.stdout, /kept {4}app\/app\/meta-ads\/components\/AdsTable\.tsx \(already yours/);
    assert.match(first.stdout, /nav {5}added a Meta Ads entry/);
    assert.match(first.stdout, /Dashboard page: http:\/\/localhost:3999\/app\/meta-ads$/m);
    assert.doesNotMatch(first.stdout, /^Opening /m, "no browser is opened when nothing answers on the port");
    assert.match(first.stdout, /Setup check:/);

    // Every shipped file landed except the conflict, which is byte-for-byte untouched.
    for (const relative of shipped) {
      assert.ok(fs.existsSync(path.join(dashboard, "app", relative)), `${relative} was added`);
    }
    assert.strictEqual(fs.readFileSync(conflict, "utf8"), conflictBody, "the pre-seeded file was not overwritten");
    assert.strictEqual(fs.readFileSync(path.join(dashboard, "app", "app", "meta-ads", "page.tsx"), "utf8"), fs.readFileSync(path.join(agentRoot, "mission-control", "app", "app", "meta-ads", "page.tsx"), "utf8"));
    // The decoy was not touched.
    assert.ok(!fs.existsSync(path.join(home, "projects", "not-a-dashboard", "app", "app")));

    // Nav entry exactly once, right after Carousel Builder.
    const nav = fs.readFileSync(navFile, "utf8");
    assert.strictEqual((nav.match(/\/app\/meta-ads/g) || []).length, 1, nav);
    assert.match(nav, /carousel-builder" },\n {2}\{ name: "Meta Ads", href: "\/app\/meta-ads" },\n/);

    // Marker lists the added files and the kept one.
    const marker = JSON.parse(fs.readFileSync(path.join(dashboard, ".allsorted-meta-ads-install.json"), "utf8"));
    assert.strictEqual(marker.name, "meta-ads");
    assert.strictEqual(marker.missionControl, dashboard);
    const added = marker.files.map((entry) => entry.relative);
    assert.ok(added.includes("app/app/meta-ads/page.tsx"));
    assert.ok(!added.includes("app/app/meta-ads/components/AdsTable.tsx"), "the kept file is not claimed as added");
    assert.deepStrictEqual(marker.skippedLastRun, ["app/app/meta-ads/components/AdsTable.tsx"]);
    assert.strictEqual(added.length, shipped.length - 1 + 1, "every other shipped file plus the nav line");

    // Second run: nothing added, nothing overwritten, nav still once.
    const snapshot = Object.fromEntries(listFiles(dashboard).map((relative) => [relative, fs.readFileSync(path.join(dashboard, relative))]));
    const second = runInstaller();
    assert.strictEqual(second.status, 0, second.stderr);
    assert.doesNotMatch(second.stdout, /^ {2}added /m, `second run added something:\n${second.stdout}`);
    assert.match(second.stdout, /kept {4}app\/app\/_nav\/nav-data\.ts \(already links meta-ads\)/);
    const after = listFiles(dashboard);
    assert.deepStrictEqual(after, Object.keys(snapshot).sort(), "second run created no files");
    for (const relative of after) {
      if (relative === ".allsorted-meta-ads-install.json") continue;
      assert.ok(snapshot[relative].equals(fs.readFileSync(path.join(dashboard, relative))), `${relative} changed on the second run`);
    }
    assert.strictEqual((fs.readFileSync(navFile, "utf8").match(/\/app\/meta-ads/g) || []).length, 1);
    const marker2 = JSON.parse(fs.readFileSync(path.join(dashboard, ".allsorted-meta-ads-install.json"), "utf8"));
    assert.strictEqual(marker2.files.length, marker.files.length, "marker does not grow on a rerun");
    assert.strictEqual(marker2.installedAt, marker.installedAt);

    // A dashboard that already has its own /app/meta-ads page keeps it; the owner dashboard lands at /dashboard and the nav points there.
    const other = path.join(home, "other-dashboard");
    fs.mkdirSync(path.join(other, "app", "app", "meta-ads"), { recursive: true });
    fs.mkdirSync(path.join(other, "app", "app", "_nav"), { recursive: true });
    fs.writeFileSync(path.join(other, "package.json"), JSON.stringify({ dependencies: { next: "15.0.0" } }));
    fs.writeFileSync(path.join(other, "app", "app", "meta-ads", "page.tsx"), "export default function Own() { return null; }\n");
    fs.writeFileSync(path.join(other, "app", "app", "_nav", "nav-data.ts"), "export const NAV_ENTRIES: NavEntry[] = [\n  { name: \"Home\", href: \"/app\" },\n];\n");
    const explicit = spawnSync("bash", [installer, "--no-open", "--mission-control", other, "--port", "3999"], { encoding: "utf8", env, cwd: home });
    assert.strictEqual(explicit.status, 0, explicit.stderr);
    assert.match(explicit.stdout, /kept {4}app\/app\/meta-ads\/page\.tsx/);
    assert.match(explicit.stdout, /Dashboard page: http:\/\/localhost:3999\/app\/meta-ads\/dashboard$/m);
    assert.match(fs.readFileSync(path.join(other, "app", "app", "_nav", "nav-data.ts"), "utf8"), /NAV_ENTRIES: NavEntry\[\] = \[\n {2}\{ name: "Meta Ads", href: "\/app\/meta-ads\/dashboard" },\n/);
    assert.strictEqual(fs.readFileSync(path.join(other, "app", "app", "meta-ads", "page.tsx"), "utf8"), "export default function Own() { return null; }\n");

    // No dashboard anywhere: says so, still runs doctor, exits 0.
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), "meta-ads-install-bare-"));
    try {
      const none = spawnSync("bash", [installer, "--no-open", "--home", bare], { encoding: "utf8", env: { ...env, HOME: bare }, cwd: bare });
      assert.strictEqual(none.status, 0, none.stderr);
      assert.match(none.stdout, /No dashboard found to put the pages into/);
      assert.match(none.stdout, /All Sorted Mission Control/);
      assert.match(none.stdout, /Setup check:/);
    } finally {
      fs.rmSync(bare, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
  console.log("install-sh.test.js passed");
}

run();
