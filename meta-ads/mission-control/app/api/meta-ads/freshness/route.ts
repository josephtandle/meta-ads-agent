import { respondSection } from "../_agent";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return respondSection("freshness", request);
}
