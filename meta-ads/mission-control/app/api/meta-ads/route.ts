import { NextResponse } from "next/server";
import { getConnectorStatus } from "@/lib/connector-status";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(getConnectorStatus("meta-ads", ["META_ADS_ACCESS_TOKEN", "META_ADS_ACCOUNT_ID"]));
}
