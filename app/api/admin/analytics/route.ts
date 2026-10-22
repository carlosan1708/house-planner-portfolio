import { NextResponse } from "next/server";
import { requirePlatformOwner } from "@/lib/auth";
import { parseUsageFilter, UsageError } from "@/lib/usage";
import { readUsageAnalytics } from "@/lib/usage-store";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store, max-age=0" };

export async function GET(request: Request) {
  if (!await requirePlatformOwner()) return NextResponse.json({ error: "Platform owner required" }, { status: 403, headers });
  try {
    const filters = parseUsageFilter(new URL(request.url).searchParams);
    return NextResponse.json(await readUsageAnalytics(filters), { headers });
  } catch (error) {
    if (!(error instanceof UsageError)) console.warn(JSON.stringify({ module: "analytics", code: "dashboard_unavailable" }));
    return NextResponse.json({ error: error instanceof UsageError ? error.message : "Analytics temporarily unavailable" }, { status: error instanceof UsageError ? error.status : 503, headers });
  }
}
