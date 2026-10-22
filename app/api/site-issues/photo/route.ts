import { randomUUID } from "node:crypto";
import { requireTabAccess } from "@/lib/auth";
import { projectBucket } from "@/lib/firebase-admin";
import { projectStoragePrefix } from "@/lib/project";
import { completedUsageAction } from "@/lib/usage-actions";

const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);

export async function GET(request: Request) {
  const actor = await requireTabAccess("site");
  if (!actor) return new Response(JSON.stringify({ error: "Site progress access required" }), { status: 403, headers: { "Content-Type": "application/json" } });
  if (!projectBucket) return new Response(JSON.stringify({ error: "Storage is unavailable" }), { status: 503, headers: { "Content-Type": "application/json" } });
  const photoPrefix = `${projectStoragePrefix(actor.projectId)}/site-issues/`;
  const key = new URL(request.url).searchParams.get("key");
  if (!key || !key.startsWith(photoPrefix)) return new Response(JSON.stringify({ error: "Photo not found" }), { status: 404, headers: { "Content-Type": "application/json" } });
  try {
    const file = projectBucket.file(key);
    const [metadata] = await file.getMetadata();
    const [bytes] = await file.download();
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": String(metadata.contentType || "image/jpeg"),
        "Content-Disposition": "inline",
        "Cache-Control": "private, max-age=300",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response(JSON.stringify({ error: "Photo not found" }), { status: 404, headers: { "Content-Type": "application/json" } });
  }
}

export async function POST(request: Request) {
  const actor = await requireTabAccess("site", ["admin", "editor"]);
  if (!actor) return new Response(JSON.stringify({ error: "Site progress editor access required" }), { status: 403, headers: { "Content-Type": "application/json" } });
  if (!projectBucket) return new Response(JSON.stringify({ error: "Storage is unavailable" }), { status: 503, headers: { "Content-Type": "application/json" } });
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return new Response(JSON.stringify({ error: "An image is required" }), { status: 400, headers: { "Content-Type": "application/json" } });
  const contentType = file.type || "image/jpeg";
  if (!ALLOWED_IMAGE_TYPES.has(contentType.toLowerCase())) return new Response(JSON.stringify({ error: "Only JPEG, PNG, WebP, and AVIF images are supported" }), { status: 415, headers: { "Content-Type": "application/json" } });
  if (file.size > 15 * 1024 * 1024) return new Response(JSON.stringify({ error: "Photos are limited to 15 MB" }), { status: 413, headers: { "Content-Type": "application/json" } });
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-");
  const uploadId = randomUUID();
  const key = `${projectStoragePrefix(actor.projectId)}/site-issues/${uploadId}-${safeName}`;
  const bytes = Buffer.from(await file.arrayBuffer());
  await projectBucket.file(key).save(bytes, {
    contentType,
    metadata: { metadata: { uploadedBy: actor.email, originalName: file.name } },
    resumable: false,
  });
  await completedUsageAction(actor, "file.upload", "site", uploadId);
  return new Response(JSON.stringify({ key, url: `/api/site-issues/photo?key=${encodeURIComponent(key)}` }), { status: 201, headers: { "Content-Type": "application/json" } });
}
