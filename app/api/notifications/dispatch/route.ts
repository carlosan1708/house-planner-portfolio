import { NextResponse } from "next/server";
import { dispatchDueNotificationJobs } from "@/lib/notification-service";
import { verifySchedulerRequest } from "@/lib/scheduler-auth";

export async function POST(request: Request) {
  if (!await verifySchedulerRequest(request)) return NextResponse.json({ error: "Scheduler authentication required" }, { status: 401 });
  return NextResponse.json(await dispatchDueNotificationJobs());
}
