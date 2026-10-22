import { FieldValue } from "firebase-admin/firestore";
import { aestheticFolderKind, aestheticId, DEFAULT_AESTHETIC_FOLDERS } from "./aesthetics";
import { firestore } from "./firebase-admin";
import { AESTHETIC_FOLDERS, projectScopedId } from "./project";

export async function ensureDefaultAestheticFolders(projectId: string, createdBy: string) {
  const query = firestore.collection(AESTHETIC_FOLDERS).where("projectId", "==", projectId);
  await firestore.runTransaction(async (transaction) => {
    const existing = await transaction.get(query);
    const active = existing.docs.filter((folder) => !folder.data().deletedAt);
    const existingPlans = active.find((folder) => !aestheticId(folder.data().parentId) && aestheticFolderKind(folder.data().kind, folder.data().name) === "plans");
    if (existingPlans) {
      if (existingPlans.data().kind !== "plans") transaction.set(existingPlans.ref, { kind: "plans", updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      return;
    }

    const defaults = active.length ? DEFAULT_AESTHETIC_FOLDERS.filter((folder) => folder.kind === "plans") : DEFAULT_AESTHETIC_FOLDERS;
    for (const folder of defaults) {
      const ref = firestore.collection(AESTHETIC_FOLDERS).doc(projectScopedId(projectId, `aesthetic-${folder.key}`));
      transaction.set(ref, {
        projectId,
        parentId: null,
        name: folder.name,
        kind: folder.kind,
        sortOrder: folder.sortOrder,
        carouselImageIds: [],
        createdBy,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        deletedAt: FieldValue.delete(),
        deletedBy: FieldValue.delete(),
      }, { merge: true });
    }
  });
}
