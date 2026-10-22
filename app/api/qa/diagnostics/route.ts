import { NextResponse } from "next/server";
import { requireApproved } from "@/lib/auth";
import { activityEvents, activityIntegrity, activityMetadata } from "@/lib/activity";
import { firestore } from "@/lib/firebase-admin";
import { previewQaWorkspace } from "@/lib/qa-reset";
import { CONFIG, NOTIFICATION_JOBS, projectConfigDoc } from "@/lib/project";
import { qaNotificationDiagnostic } from "@/lib/qa-diagnostics";

export const runtime = "nodejs";

export async function GET() {
  const actor = await requireApproved(["admin"]);
  if (!actor) return NextResponse.json({ error: "QA access required" }, { status: 403 });
  try {
    const [preview, config, head, events, jobs] = await Promise.all([
      previewQaWorkspace(actor),
      firestore.collection(CONFIG).doc(projectConfigDoc(actor.projectId)).get(),
      activityMetadata(actor.projectId).get(),
      activityEvents(actor.projectId).get(),
      firestore.collection(NOTIFICATION_JOBS).where("projectId", "==", actor.projectId).get(),
    ]);
    const invalidActivity = events.docs.filter((event) => activityIntegrity(event.data()) !== "verified").length;
    return NextResponse.json({
      projectId: actor.projectId,
      counts: preview.counts,
      storage: { files: preview.storedFiles, bytes: preview.storedBytes },
      workbook: {
        planVersion: Number(config.data()?.workbookPlanVersion || 1),
        actualsRevision: Number(config.data()?.workbookActualsRevision || 0),
      },
      activity: { total: events.size, invalid: invalidActivity, sequence: Number(head.data()?.sequence || 0) },
      notifications: jobs.docs.map((job) => qaNotificationDiagnostic(job.data()))
        .sort((a, b) => String(a.runAt).localeCompare(String(b.runAt))),
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "QA access required" }, { status: 403 });
  }
}
