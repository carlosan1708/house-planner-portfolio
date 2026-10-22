import { NextResponse } from "next/server";
import { canAccessFolder, requireTabAccess } from "@/lib/auth";
import { firestore, projectBucket } from "@/lib/firebase-admin";
import { DOCUMENTS } from "@/lib/project";
import { indexDocumentBytes, refreshDocumentIndex } from "@/lib/document-index";
import { buildTopLevelFolderMap, folderTopLevelId, listProjectFolders } from "@/lib/folders";

export async function POST(request: Request) {
  const actor = await requireTabAccess("documents", ["admin", "editor"]);
  if (!actor) return NextResponse.json({ error: "Documents editor access required" }, { status: 403 });
  const body = await request.json().catch(() => null) as { id?: string; action?: "index" | "status" } | null;
  if (!body?.id) return NextResponse.json({ error: "Document is required" }, { status: 400 });
  const ref = firestore.collection(DOCUMENTS).doc(body.id);
  const snapshot = await ref.get();
  const data = snapshot.data();
  if (!snapshot.exists || data?.projectId !== actor.projectId || data?.deletedAt) return NextResponse.json({ error: "Document not found" }, { status: 404 });
  const folderId = typeof data.folderId === "string" ? data.folderId : null;
  const folders = await listProjectFolders(actor.projectId);
  const topLevelId = folderTopLevelId(folderId, buildTopLevelFolderMap(folders));
  if (data.encrypted === true || folders.some((folder) => folder.id === topLevelId && folder.encrypted))
    return NextResponse.json({ error: "Encrypted documents are excluded from the assistant" }, { status: 403 });
  if (!canAccessFolder(actor, folderId, topLevelId)) return NextResponse.json({ error: "Document not found" }, { status: 404 });
  if (body.action === "status") return NextResponse.json({ status: await refreshDocumentIndex(actor.projectId, body.id) });
  if (!projectBucket) return NextResponse.json({ error: "Storage unavailable" }, { status: 503 });
  const [bytes] = await projectBucket.file(String(data.objectKey)).download();
  return NextResponse.json(await indexDocumentBytes({ projectId: actor.projectId, documentId: body.id, bytes, fileName: String(data.fileName || "document"), contentType: String(data.contentType || "application/octet-stream"), folderId }));
}
