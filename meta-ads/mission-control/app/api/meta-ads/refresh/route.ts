import { respondRefresh } from "../_agent";

export const dynamic = "force-dynamic";

// Runs the agent's read-only sync (node src/index.js refresh). It reads from
// Meta and writes only the agent's local cache; it never changes an ad account.
export async function POST() {
  return respondRefresh();
}
