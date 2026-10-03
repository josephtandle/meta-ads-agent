// Shared plumbing for the Meta Ads dashboard routes. Every route is a thin
// adapter: this file finds the agent folder, loads its read-only data layer
// (src/dashboard-data.js) through Node's own require at runtime, and turns the
// reply into a Response. Every rule (redaction, the budget cap, the write gate)
// lives in the agent; nothing here can change an ad account.
import * as nodeModule from "node:module";
import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";

/**
 * The install root: the folder that holds mission-control and the agent side by
 * side. ALLSORTED_WORKSPACE may point at the install root or at the
 * mission-control folder itself, so both are checked.
 */
export function installRoot(): string {
  const bundle = (process.env.ALLSORTED_BUNDLE_ROOT || "").trim();
  if (bundle) return path.resolve(bundle);
  const workspace = path.resolve((process.env.ALLSORTED_WORKSPACE || "").trim() || process.cwd());
  const parent = path.dirname(workspace);
  for (const candidate of [workspace, parent]) {
    if (fs.existsSync(path.join(candidate, "meta-ads", "package.json"))) return candidate;
    if (fs.existsSync(path.join(candidate, "agents", "meta-ads", "package.json"))) return candidate;
  }
  return path.basename(workspace) === "mission-control" ? parent : workspace;
}

/** Where the Meta Ads agent lives: META_ADS_AGENT_DIR, else <root>/meta-ads, else <root>/agents/meta-ads. */
export function agentDir(): string {
  const fromEnv = (process.env.META_ADS_AGENT_DIR || "").trim();
  if (fromEnv) return path.resolve(fromEnv);
  const root = installRoot();
  const beside = path.join(root, "meta-ads");
  if (fs.existsSync(path.join(beside, "package.json"))) return beside;
  return path.join(root, "agents", "meta-ads");
}

// Node's own createRequire, looked up by a computed name at runtime. A direct
// createRequire(...) call is rewritten by the bundler into its own module
// loader, which cannot load a folder that only exists on the installed machine.
type CreateRequire = (from: string) => (id: string) => unknown;
const createNodeRequire = (nodeModule as unknown as Record<string, CreateRequire>)[["create", "Require"].join("")];

const NO_STORE = { "Cache-Control": "no-store" };
const NOT_INSTALLED = "The Meta Ads agent was not found beside Mission Control. Install it (meta-ads/install.sh) or set META_ADS_AGENT_DIR to its folder, then reload this page.";
const UPDATE_NEEDED = "This screen needs a newer Meta Ads agent (one with src/dashboard-data.js). Update the agent, then reload this page.";
const NOT_LOADED = "The Meta Ads agent could not be loaded. The terminal that runs Mission Control has the details.";
const UNEXPECTED = "The Meta Ads dashboard hit an unexpected problem. The terminal that runs Mission Control has the details.";

export type SectionName = "overview" | "ads" | "improvements" | "summary" | "freshness";
interface DataLayer {
  SECTIONS: string[];
  section(name: string, options: { period?: string }): Promise<Record<string, unknown>>;
  refresh(options?: { timeoutMs?: number }): Promise<Record<string, unknown>>;
}

class Unavailable extends Error {}

export interface AgentInfo { dir: string; dataLayer: string; installed: boolean; current: boolean }

export function agentInfo(): AgentInfo {
  const dir = agentDir();
  const dataLayer = path.join(dir, "src", "dashboard-data.js");
  const installed = fs.existsSync(path.join(dir, "package.json"));
  return { dir, dataLayer, installed, current: installed && fs.existsSync(dataLayer) };
}

// Each route is bundled on its own, so the loaded module lives on globalThis:
// every route in the process shares one instance of the agent's data layer.
const INSTANCE_KEY = "__metaAdsDashboardData";
interface Instance { key: string; data: DataLayer }

function instance(): DataLayer {
  const info = agentInfo();
  if (!info.current) throw new Unavailable(info.installed ? UPDATE_NEEDED : NOT_INSTALLED);
  const holder = globalThis as unknown as Record<string, Instance | undefined>;
  const current = holder[INSTANCE_KEY];
  if (current && current.key === info.dataLayer) return current.data;
  let loaded: DataLayer;
  try {
    loaded = createNodeRequire(path.join(info.dir, "package.json"))(info.dataLayer) as DataLayer;
  } catch (error) {
    console.error("[meta-ads] the agent data layer could not be loaded:", error);
    throw new Unavailable(NOT_LOADED);
  }
  if (!loaded || typeof loaded.section !== "function") throw new Unavailable(UPDATE_NEEDED);
  holder[INSTANCE_KEY] = { key: info.dataLayer, data: loaded };
  return loaded;
}

function failure(status: number, error: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ ok: false, error, ...extra }, { status, headers: NO_STORE });
}

/** GET one section of the agent's dashboard data. Never throws: a missing or old agent answers 503. */
export async function respondSection(name: SectionName, request: Request): Promise<Response> {
  try {
    const period = new URL(request.url).searchParams.get("period") || undefined;
    const data = await instance().section(name, { period });
    return NextResponse.json({ ok: true, ...data }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof Unavailable) return failure(503, error.message, { agent: agentInfo() });
    console.error(`[meta-ads] ${name} failed:`, error);
    return failure(500, UNEXPECTED);
  }
}

/** POST: run the agent's read-only sync. The agent itself refuses without credentials. */
export async function respondRefresh(): Promise<Response> {
  try {
    const result = await instance().refresh({ timeoutMs: 180000 });
    const ok = result.ok === true;
    const ran = result.ran === true;
    return NextResponse.json(result, { status: ok ? 200 : ran ? 502 : 409, headers: NO_STORE });
  } catch (error) {
    if (error instanceof Unavailable) return failure(503, error.message, { agent: agentInfo() });
    console.error("[meta-ads] refresh failed:", error);
    return failure(500, UNEXPECTED);
  }
}

export { Unavailable, NO_STORE, failure };
