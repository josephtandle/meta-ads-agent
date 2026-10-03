import { spawn } from "node:child_process";
import path from "node:path";
import { NextResponse } from "next/server";
import { agentInfo, NO_STORE, failure } from "../_agent";

export const dynamic = "force-dynamic";

// The agent's own setup check (node src/index.js doctor), run as a child
// process so credentials never enter the Mission Control process. The agent
// redacts its output; this route only relays it.
export async function GET() {
  const info = agentInfo();
  if (!info.installed) return failure(503, "The Meta Ads agent was not found beside Mission Control.", { agent: info });
  return new Promise<Response>((resolve) => {
    const child = spawn(process.execPath, [path.join(info.dir, "src", "index.js"), "doctor"], { cwd: info.dir, env: process.env });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill(), 30000);
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", (error) => { clearTimeout(timer); resolve(failure(500, `doctor could not start: ${error.message}`)); });
    child.on("close", (code) => {
      clearTimeout(timer);
      let report: unknown = null;
      try { report = JSON.parse(stdout); } catch { report = null; }
      resolve(NextResponse.json({ ok: code === 0 && report !== null, exitCode: code, report, stderr: stderr.trim() || null }, { status: code === 0 ? 200 : 502, headers: NO_STORE }));
    });
  });
}
