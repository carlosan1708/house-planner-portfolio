import { FieldValue } from "firebase-admin/firestore";
import { firestore, projectBucket } from "./firebase-admin";
import { workbookConfig } from "./workbook-store";
import { syncGoogleBudget } from "./google-budget";
import { ensureExpenseInvoiceFolder, ensureExpensePurchaseFolder } from "./folders";
import { ensureDefaultAestheticFolders } from "./aesthetic-folders";
import {
  CONFIG,
  MEMBERSHIPS,
  PROJECTS,
  projectConfigDoc,
  projectStoragePrefix,
  type MemberRecord,
} from "./project";
import { QA_RESETTABLE_COLLECTIONS, qaProjectIdentityAllowed, qaResetEligibility } from "./qa-reset-policy";
import { activityEvents, activityMetadata, commitActivity } from "./activity";
import { distributionRef, distributionRequestRef } from "./house-distribution-store";
import { assertIsolatedQaEnvironment } from "./qa-environment.mjs";

export type QaResetPreview = {
  projectId: string;
  projectName: string;
  records: number;
  storedFiles: number;
  storedBytes: number;
  otherMembers: number;
  counts: Record<string, number>;
};

async function projectSnapshots(projectId: string) {
  const entries = await Promise.all(QA_RESETTABLE_COLLECTIONS.map(async (collection) => {
    const snapshot = await firestore.collection(collection).where("projectId", "==", projectId).get();
    return [collection, snapshot] as const;
  }));
  return new Map(entries);
}

async function storageFiles(projectId: string) {
  if (!projectBucket) throw new Error("storage_unavailable");
  const prefix = `${projectStoragePrefix(projectId)}/`;
  const [files] = await projectBucket.getFiles({ prefix });
  return { prefix, files };
}

export async function assertQaWorkspace(actor: MemberRecord) {
  assertIsolatedQaEnvironment();
  if (!qaResetEligibility(actor).allowed) throw new Error("qa_reset_forbidden");
  const project = await firestore.collection(PROJECTS).doc(actor.projectId).get();
  const data = project.data();
  if (!qaProjectIdentityAllowed(actor, { exists: project.exists, ownerUid: data?.ownerUid, kind: data?.kind })) throw new Error("qa_project_mismatch");
  return project;
}

export async function previewQaWorkspace(actor: MemberRecord): Promise<QaResetPreview> {
  await assertQaWorkspace(actor);
  const [snapshots, memberships, storage] = await Promise.all([
    projectSnapshots(actor.projectId),
    firestore.collection(MEMBERSHIPS).where("projectId", "==", actor.projectId).get(),
    storageFiles(actor.projectId),
  ]);
  const config = await firestore.collection(CONFIG).doc(projectConfigDoc(actor.projectId)).get();
  const counts = Object.fromEntries([...snapshots.entries()].map(([collection, snapshot]) => [collection, snapshot.size]));
  const activity = await activityEvents(actor.projectId).get();
  counts.activityEvents = activity.size;
  if (config.exists) counts[CONFIG] = 1;
  const distribution = await firestore.getAll(distributionRef(actor.projectId), distributionRequestRef(actor.projectId));
  counts.distribution = distribution.filter((document) => document.exists).length;
  const otherMembers = memberships.docs.filter((document) => String(document.data().uid || "") !== actor.uid).length;
  return {
    projectId: actor.projectId,
    projectName: actor.projectName,
    records: Object.values(counts).reduce((sum, count) => sum + count, 0),
    storedFiles: storage.files.length,
    storedBytes: storage.files.reduce((sum, file) => sum + Number(file.metadata.size || 0), 0),
    otherMembers,
    counts,
  };
}

async function deleteSnapshots(snapshots: Map<string, FirebaseFirestore.QuerySnapshot>) {
  for (const snapshot of snapshots.values()) {
    for (const document of snapshot.docs) await firestore.recursiveDelete(document.ref);
  }
}

export async function resetQaWorkspace(actor: MemberRecord) {
  await assertQaWorkspace(actor);
  if (!projectBucket) throw new Error("storage_unavailable");
  const projectRef = firestore.collection(PROJECTS).doc(actor.projectId);
  await firestore.runTransaction(async (transaction) => {
    const project = await transaction.get(projectRef);
    const data = project.data();
    if (!qaProjectIdentityAllowed(actor, { exists: project.exists, ownerUid: data?.ownerUid, kind: data?.kind })) throw new Error("qa_project_mismatch");
    if (project.data()?.qaResetInProgress) throw new Error("qa_reset_in_progress");
    transaction.set(projectRef, { qaResetInProgress: true, qaResetStartedAt: FieldValue.serverTimestamp(), qaResetStartedBy: actor.email }, { merge: true });
  });

  try {
    const preview = await previewQaWorkspace(actor);
    const [snapshots, memberships] = await Promise.all([
      projectSnapshots(actor.projectId),
      firestore.collection(MEMBERSHIPS).where("projectId", "==", actor.projectId).get(),
    ]);
    await deleteSnapshots(snapshots);
    for (const membership of memberships.docs) {
      if (String(membership.data().uid || "") !== actor.uid) await firestore.recursiveDelete(membership.ref);
    }
    await firestore.recursiveDelete(firestore.collection(CONFIG).doc(projectConfigDoc(actor.projectId)));
    await firestore.recursiveDelete(activityEvents(actor.projectId));
    await firestore.recursiveDelete(activityMetadata(actor.projectId));
    await firestore.recursiveDelete(distributionRef(actor.projectId));
    await firestore.recursiveDelete(distributionRequestRef(actor.projectId));
    await projectBucket.deleteFiles({ prefix: `${projectStoragePrefix(actor.projectId)}/`, force: true });
    await workbookConfig(actor.projectId, { skipGoogleSync: true });
    await Promise.all([
      ensureExpenseInvoiceFolder(actor.projectId, actor.email),
      ensureExpensePurchaseFolder(actor.projectId, actor.email),
    ]);
    await ensureDefaultAestheticFolders(actor.projectId, actor.email);
    await commitActivity(actor, {
      category: "project", action: "qa.reset", source: "system",
      target: { type: "project", id: actor.projectId, label: actor.projectName, section: "overview" },
      summaryParams: { records: preview.records, files: preview.storedFiles },
      visibility: { requiredTabs: ["overview"], adminOnly: true },
    }, (transaction) => transaction.set(projectRef, {
        qaResetInProgress: false,
        qaResetStartedAt: FieldValue.delete(),
        qaResetCompletedAt: FieldValue.serverTimestamp(),
        qaResetCompletedBy: actor.email,
        qaLastResetRecords: preview.records,
        qaLastResetFiles: preview.storedFiles,
      }, { merge: true }));
    await syncGoogleBudget(actor.projectId, undefined, false, true);
    return preview;
  } catch (error) {
    await projectRef.set({ qaResetInProgress: false, qaResetStartedAt: FieldValue.delete(), qaResetErrorAt: FieldValue.serverTimestamp() }, { merge: true });
    throw error;
  }
}
