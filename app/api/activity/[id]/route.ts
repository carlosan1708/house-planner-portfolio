import { NextResponse } from "next/server";
import { requireApproved } from "@/lib/auth";
import { activityEvents, activityIntegrity, canViewActivity, serializeActivity } from "@/lib/activity";
import { projectBucket } from "@/lib/firebase-admin";
import { projectStoragePrefix } from "@/lib/project";
import { loadProjectAuthorDisplay } from "@/lib/project-authors";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await requireApproved();
  if (!actor || actor.isPersonal || (actor.role !== "admin" && !actor.permissions.activity)) {
    return NextResponse.json({ error: "Activity not found" }, { status: 404 });
  }
  const { id } = await context.params;
  const snapshot = await activityEvents(actor.projectId).doc(id.slice(0, 200)).get();
  const data = snapshot.data();
  if (!snapshot.exists || !data || !canViewActivity(actor, data)) return NextResponse.json({ error: "Activity not found" }, { status: 404 });
  let details: unknown = null;
  const detailsObjectKey = String(data.detailsObjectKey || "");
  const allowedPrefix = `${projectStoragePrefix(actor.projectId)}/`;
  if (detailsObjectKey.startsWith(allowedPrefix) && projectBucket && activityIntegrity(data) === "verified") {
    try {
      const [bytes] = await projectBucket.file(detailsObjectKey).download();
      details = JSON.parse(bytes.toString("utf8"));
    } catch { details = null; }
  }
  console.info(JSON.stringify({ event: "activity_detail_read", projectId: actor.projectId, actorUid: actor.uid, activityId: id }));
  const authors = await loadProjectAuthorDisplay(actor.projectId);
  return NextResponse.json({ event: serializeActivity(snapshot, authors), details }, { headers: { "Cache-Control": "private, no-store" } });
}
