import { canAccessFolder, requireTabAccess } from "@/lib/auth";
import { firestore } from "@/lib/firebase-admin";
import { buildTopLevelFolderMap, folderTopLevelId, listProjectFolders } from "@/lib/folders";
import { CONFIG, projectConfigDoc } from "@/lib/project";
import { loadProjectAuthorDisplay } from "@/lib/project-authors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const actor = await requireTabAccess("documents");
  if (!actor) return Response.json({ error: "Documents access required" }, { status: 403 });
  const folders = await listProjectFolders(actor.projectId);
  const topLevelMap = buildTopLevelFolderMap(folders);
  const snapshot = await firestore.collection(CONFIG).doc(projectConfigDoc(actor.projectId)).get();
  const data = snapshot.data();
  const updatedFolderIds = Array.isArray(data?.documentsUpdatedFolderIds)
    ? data.documentsUpdatedFolderIds.filter((id: unknown): id is string | null => id === null || typeof id === "string")
    : [];
  const ordinaryFolderIds = updatedFolderIds.filter((folderId: string | null) =>
    !folders.some((folder) => folder.id === folderTopLevelId(folderId, topLevelMap) && folder.encrypted === true));
  const includesEncryptedUpdate = ordinaryFolderIds.length !== updatedFolderIds.length;
  const relevant = !updatedFolderIds.length || ordinaryFolderIds.some((folderId: string | null) =>
    actor.role === "admin" || actor.folderAccess.mode === "all" || canAccessFolder(actor, folderId, folderTopLevelId(folderId, topLevelMap)));
  const currentVersion = Number(data?.documentsVersion || 0);
  const requestedVersionParam = new URL(request.url).searchParams.get("version");
  const requestedVersion = requestedVersionParam === null ? Number.NaN : Number(requestedVersionParam);
  const knownVersion = Number.isSafeInteger(requestedVersion) && requestedVersion >= 0 ? requestedVersion : null;
  const updatedBy = relevant && !includesEncryptedUpdate ? String(data?.documentsUpdatedBy || "") : "";
  const authors = updatedBy ? await loadProjectAuthorDisplay(actor.projectId) : null;

  return Response.json({
    version: relevant ? currentVersion : knownVersion ?? 0,
    updatedBy: authors ? authors.display(updatedBy, data?.documentsUpdatedAt) : "",
  }, {
    headers: { "Cache-Control": "private, no-store, max-age=0" },
  });
}
