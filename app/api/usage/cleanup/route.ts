import { NextResponse } from "next/server";
import { verifySchedulerRequest } from "@/lib/scheduler-auth";
import { cleanupUsage } from "@/lib/usage-store";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store, max-age=0" };

export async function POST(request: Request) {
  if (!await verifySchedulerRequest(request)) return NextResponse.json({ error: "Scheduler authentication required" }, { status: 401, headers });
  try { return NextResponse.json(await cleanupUsage(), { headers }); }
  catch {
    console.warn(JSON.stringify({ module: "analytics", code: "cleanup_failed" }));
    return NextResponse.json({ error: "Analytics cleanup failed" }, { status: 503, headers });
  }
}
