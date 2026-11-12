import { NextResponse } from "next/server";
import { requireTabAccess } from "@/lib/auth";
import { firestore, projectBucket } from "@/lib/firebase-admin";
import { AESTHETIC_IMAGES } from "@/lib/project";
import { canReadGeneratedAesthetic } from "@/lib/assistant-plan-sources";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireTabAccess("aesthetics");
  if (!actor) return NextResponse.json({ error: "Aesthetics access required" }, { status: 403 });
  if (!projectBucket) return NextResponse.json({ error: "Storage is unavailable" }, { status: 503 });
  const { id } = await params;
  const image = await firestore.collection(AESTHETIC_IMAGES).doc(id).get();
  const data = image.data();
  if (!image.exists || !data || data.projectId !== actor.projectId || data.deletedAt) return NextResponse.json({ error: "Image not found" }, { status: 404 });
  if (data.assistantPlanSource !== undefined && !await canReadGeneratedAesthetic(actor, data.assistantPlanSource)) return NextResponse.json({ error: "Image not found" }, { status: 404 });
  const contentType = data.contentType === "application/pdf" ? "application/pdf" : "image/jpeg";
  const thumbnail = contentType !== "application/pdf" && new URL(request.url).searchParams.get("thumb") === "1";
  const objectKey = thumbnail ? data.thumbnailObjectKey : data.objectKey;
  if (typeof objectKey !== "string" || !objectKey) return NextResponse.json({ error: "Image not found" }, { status: 404 });
  const [bytes] = await projectBucket.file(objectKey).download();
  if (data.assistantPlanSource !== undefined) {
    const current = await requireTabAccess("aesthetics");
    if (!current || current.projectId !== actor.projectId || current.uid !== actor.uid || !await canReadGeneratedAesthetic(current, data.assistantPlanSource))
      return NextResponse.json({ error: "Image not found" }, { status: 404 });
  }
  return new Response(new Uint8Array(bytes), { headers: { "Content-Type": thumbnail ? "image/webp" : contentType, "Content-Disposition": "inline", "Cache-Control": data.assistantPlanSource === undefined ? "private, max-age=300" : "private, no-store", "X-Content-Type-Options": "nosniff" } });
}
