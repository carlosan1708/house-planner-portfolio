import { NextResponse } from "next/server";
import { canAccessFolder, requireTabAccess } from "@/lib/auth";
import { firestore } from "@/lib/firebase-admin";
import {
  applyFeaturedDocumentsChange, featuredDocumentId, normalizeFeaturedDocumentIds,
  parseFeaturedDocumentsChange,
} from "@/lib/featured-documents";
import {
  CONFIG, DOCUMENTS, FOLDERS, LEGACY_PROJECT_ID, MEMBERSHIPS, USERS,
  membershipId, normalizeFolderAccess, normalizePermissions, projectConfigDoc,
  type MemberRecord,
} from "@/lib/project";

const privateHeaders = { "Cache-Control": "private, no-store" };
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: privateHeaders });
type FolderRecords = Map<string, FirebaseFirestore.DocumentData>;
type OrdinaryLocation = { folderId: string | null; topLevelId: string | null };

class SelectionFailure extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

function conflictingOwner(data: FirebaseFirestore.DocumentData | undefined, projectId: string) {
  return data?.projectId !== undefined && data.projectId !== projectId;
}

function folderRecords(snapshot: FirebaseFirestore.QuerySnapshot): FolderRecords {
  return new Map(snapshot.docs.map(folder => [folder.id, folder.data()]));
}

/** Structural eligibility is independent of the caller's grants so hidden ordinary selections survive. */
function ordinaryLocation(data: FirebaseFirestore.DocumentData | undefined, projectId: string, folders: FolderRecords): OrdinaryLocation | null {
  if (!data || data.projectId !== projectId || data.deletedAt || data.encrypted === true
    || data.encryptionCleanupPending === true || data.vaultFolderId || data.encryptedMetadata) return null;
  if (data.folderId !== undefined && data.folderId !== null && typeof data.folderId !== "string") return null;
  const folderId = typeof data.folderId === "string" && data.folderId ? data.folderId : null;
  if (!folderId) return { folderId: null, topLevelId: null };
  if (!featuredDocumentId(folderId)) return null;
  const visited = new Set<string>();
  let id = folderId;
  while (true) {
    if (visited.has(id)) return null;
    visited.add(id);
    const folder = folders.get(id);
    if (!folder || folder.projectId !== projectId || folder.deletedAt || folder.encrypted === true) return null;
    const parent = folder.parentId;
    if (parent === undefined || parent === null || parent === "") {
      const name = String(folder.name || "Folder").trim().toLocaleLowerCase();
      if (name === "factura" || name === "compras") return null;
      return { folderId, topLevelId: id };
    }
    if (!featuredDocumentId(parent)) return null;
    id = parent;
  }
}

function visibleIds(ids: string[], locations: Map<string, OrdinaryLocation>, actor: MemberRecord) {
  return ids.filter(id => {
    const location = locations.get(id);
    return location && canAccessFolder(actor, location.folderId, location.topLevelId);
  });
}

/** Membership and folder grants participate in retries instead of relying on the dialog's old actor. */
async function currentCurator(transaction: FirebaseFirestore.Transaction, actor: MemberRecord): Promise<MemberRecord> {
  const denied = () => { throw new SelectionFailure(403, "Documents management access required"); };
  const [membership, identity] = await transaction.getAll(
    firestore.collection(MEMBERSHIPS).doc(membershipId(actor.projectId, actor.uid)),
    firestore.collection(USERS).doc(actor.uid),
  );
  if (!identity.exists) denied();
  let data = membership.data();
  if (membership.exists) {
    if (data?.projectId !== actor.projectId || data.uid !== actor.uid) denied();
  } else {
    // Match getSessionMember's pre-membership compatibility without reviving a removed membership.
    if (actor.projectId !== LEGACY_PROJECT_ID || identity.data()?.multiTenantReady === true) denied();
    const memberships = await transaction.get(firestore.collection(MEMBERSHIPS).where("uid", "==", actor.uid));
    if (memberships.docs.length) denied();
    data = identity.data();
  }
  if (!data || data.status !== "approved" || data.removed === true || data.accessLinkId || data.anonymousLink === true) denied();
  // Use the same role and permission normalization as the canonical session resolver.
  const role = data!.role === "admin" || data!.role === "viewer" ? data!.role : "editor";
  const permissions = normalizePermissions(data!.permissions);
  if (role === "viewer" || (role !== "admin" && !permissions.documents)) denied();
  return { ...actor, role, status: "approved", permissions, folderAccess: normalizeFolderAccess(data!.folderAccess) };
}

export async function GET() {
  const actor = await requireTabAccess("documents");
  if (!actor) return reply({ error: "Documents access required" }, 403);
  try {
    const config = await firestore.collection(CONFIG).doc(projectConfigDoc(actor.projectId)).get();
    if (conflictingOwner(config.data(), actor.projectId)) return reply({ error: "Project configuration is unavailable" }, 503);
    const saved = normalizeFeaturedDocumentIds(config.data()?.featuredDocumentIds);
    if (!saved.length) return reply({ documentIds: [] });
    const [folderSnapshot, documents] = await Promise.all([
      firestore.collection(FOLDERS).where("projectId", "==", actor.projectId).get(),
      firestore.getAll(...saved.map(id => firestore.collection(DOCUMENTS).doc(id))),
    ]);
    const folders = folderRecords(folderSnapshot), locations = new Map<string, OrdinaryLocation>();
    for (const document of documents) {
      const location = ordinaryLocation(document.data(), actor.projectId, folders);
      if (document.exists && location) locations.set(document.id, location);
    }
    return reply({ documentIds: visibleIds(saved, locations, actor) });
  } catch {
    return reply({ error: "Could not load featured documents. Try again." }, 503);
  }
}

export async function PATCH(request: Request) {
  const actor = await requireTabAccess("documents", ["admin", "editor"]);
  if (!actor || actor.accessLinkId || actor.anonymousLink) return reply({ error: "Documents management access required" }, 403);
  const change = parseFeaturedDocumentsChange(await request.json().catch(() => null));
  if (!change) return reply({ error: "Provide valid document additions and removals, up to 30 each." }, 400);
  try {
    const documentIds = await firestore.runTransaction(async transaction => {
      const curator = await currentCurator(transaction, actor);
      const ref = firestore.collection(CONFIG).doc(projectConfigDoc(curator.projectId));
      const [config, folderSnapshot] = await Promise.all([
        transaction.get(ref),
        transaction.get(firestore.collection(FOLDERS).where("projectId", "==", curator.projectId)),
      ]);
      if (conflictingOwner(config.data(), curator.projectId)) throw new SelectionFailure(503, "Project configuration is unavailable");
      const saved = normalizeFeaturedDocumentIds(config.data()?.featuredDocumentIds);
      const requested = [...change.addIds, ...change.removeIds];
      const relevant = normalizeFeaturedDocumentIds([...saved, ...requested]);
      const documents = relevant.length ? await transaction.getAll(...relevant.map(id => firestore.collection(DOCUMENTS).doc(id))) : [];
      const folders = folderRecords(folderSnapshot), locations = new Map<string, OrdinaryLocation>();
      for (const document of documents) {
        const location = ordinaryLocation(document.data(), curator.projectId, folders);
        if (document.exists && location) locations.set(document.id, location);
      }
      // Validate every submitted ID before any metadata cleanup or selection write, including removals.
      if (visibleIds(requested, locations, curator).length !== requested.length) {
        throw new SelectionFailure(403, "One or more requested documents are unavailable");
      }
      const retained = saved.filter(id => locations.has(id));
      let next: string[];
      try { next = applyFeaturedDocumentsChange(retained, change); }
      catch (error) {
        if (error instanceof RangeError) throw new SelectionFailure(409, "The project can feature up to 30 documents. Remove an eligible selection before adding another.");
        throw error;
      }
      transaction.set(ref, { featuredDocumentIds: next }, { merge: true });
      return visibleIds(next, locations, curator);
    });
    return reply({ documentIds });
  } catch (error) {
    if (error instanceof SelectionFailure) return reply({ error: error.message }, error.status);
    return reply({ error: "Could not save featured documents. Try again." }, 503);
  }
}
