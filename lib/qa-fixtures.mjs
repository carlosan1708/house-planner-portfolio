import { FieldValue } from "firebase-admin/firestore";
import { assertIsolatedQaEnvironment, QA_PRIMARY_PROJECT, QA_ISOLATION_PROJECT } from "./qa-environment.mjs";

export const QA_FIXTURE_VERSION = 1;
export const QA_IDENTITIES = Object.freeze([
  { key: "owner", email: "qa.houseplanner.20260830@example.com", name: "QA Administrator", role: "admin", projectId: QA_PRIMARY_PROJECT, passwordEnv: "QA_OWNER_PASSWORD" },
  { key: "companion", email: "qa.houseplanner.viewer.20260831@example.com", name: "QA Access Lifecycle", role: "viewer", projectId: QA_PRIMARY_PROJECT, passwordEnv: "QA_COMPANION_PASSWORD" },
  { key: "editor", email: "qa.houseplanner.editor@example.com", name: "QA Editor", role: "editor", projectId: QA_PRIMARY_PROJECT, passwordEnv: "QA_EDITOR_PASSWORD" },
  { key: "viewer", email: "qa.houseplanner.reader@example.com", name: "QA Viewer", role: "viewer", projectId: QA_PRIMARY_PROJECT, passwordEnv: "QA_VIEWER_PASSWORD" },
  { key: "restricted", email: "qa.houseplanner.restricted@example.com", name: "QA Restricted Viewer", role: "viewer", projectId: QA_PRIMARY_PROJECT, passwordEnv: "QA_RESTRICTED_PASSWORD" },
  { key: "outsider", email: "qa.houseplanner.outside@example.com", name: "QA Other Project Administrator", role: "admin", projectId: QA_ISOLATION_PROJECT, passwordEnv: "QA_OUTSIDER_PASSWORD" },
]);
export const QA_FIXTURE_IDS = Object.freeze({
  visibleFolder: "qa-primary__qa-fixture-visible", hiddenFolder: "qa-primary__qa-fixture-hidden",
  visibleDocument: "qa-primary__qa-fixture-visible-document", hiddenDocument: "qa-primary__qa-fixture-hidden-document",
  primaryNote: "qa-primary__qa-fixture-note", isolationNote: "qa-isolation__qa-fixture-note",
  isolationDocument: "qa-isolation__qa-fixture-document",
});
const tabs = ["overview", "activity", "budget", "quotes", "expenses", "documents", "notes", "aesthetics", "distribution", "approvals", "plan", "decisions", "site"];
export function qaIdentityMembership(identity, uid) {
  const restricted = identity.key === "restricted";
  return {
    uid, projectId: identity.projectId, role: identity.role, status: "approved",
    permissions: Object.fromEntries(tabs.map((tab) => [tab, !restricted || ["overview", "documents", "notes"].includes(tab)])),
    folderAccess: restricted ? { mode: "selected", folderIds: [QA_FIXTURE_IDS.visibleFolder], allowUnfiled: false } : { mode: "all", folderIds: [], allowUnfiled: true },
    qaFixtureVersion: QA_FIXTURE_VERSION,
  };
}

// Every mutation is preceded by the same guard as the application. The allowlist is fixed,
// and this function never imports or copies production records or credentials.
export async function seedQaFixtures({ auth, firestore, bucket, provisionAuth = false, env = process.env }) {
  const config = assertIsolatedQaEnvironment(env);
  if (!bucket || bucket.name !== config.storageBucket) throw new Error("QA fixture bucket mismatch");
  if (provisionAuth) {
    for (const identity of QA_IDENTITIES) {
      const password = env[identity.passwordEnv];
      if (typeof password !== "string" || password.length < 12 || password.length > 128) throw new Error(`Missing or invalid ${identity.passwordEnv}`);
    }
  }
  const users = [];
  for (const identity of QA_IDENTITIES) {
    let user;
    try { user = await auth.getUserByEmail(identity.email); }
    catch (error) {
      if (!provisionAuth || error?.code !== "auth/user-not-found") throw error;
      user = await auth.createUser({ email: identity.email, password: env[identity.passwordEnv], displayName: identity.name, emailVerified: true, disabled: false });
    }
    if (provisionAuth) user = await auth.updateUser(user.uid, { password: env[identity.passwordEnv], displayName: identity.name, emailVerified: true, disabled: false });
    users.push({ ...identity, uid: user.uid });
  }
  const batch = firestore.batch();
  const timestamp = FieldValue.serverTimestamp();
  for (const user of users) {
    batch.set(firestore.collection("housePlannerUsers").doc(user.uid), { uid: user.uid, email: user.email, name: user.name, status: "approved", multiTenantReady: true, legacyAccess: false, updatedAt: timestamp }, { merge: true });
    for (const projectId of [QA_PRIMARY_PROJECT, QA_ISOLATION_PROJECT]) {
      const ref = firestore.collection("housePlannerProjectMemberships").doc(`${projectId}__${user.uid}`);
      if (user.projectId === projectId) batch.set(ref, { ...qaIdentityMembership(user, user.uid), joinedAt: timestamp, updatedAt: timestamp });
      else batch.delete(ref);
    }
  }
  for (const [id, ownerKey, name] of [[QA_PRIMARY_PROJECT, "owner", "QA Primary"], [QA_ISOLATION_PROJECT, "outsider", "QA Isolation"]]) {
    batch.set(firestore.collection("housePlannerProjects").doc(id), { id, kind: "shared", name, ownerUid: users.find((user) => user.key === ownerKey).uid, qaFixtureVersion: QA_FIXTURE_VERSION, updatedAt: timestamp }, { merge: true });
  }
  for (const [id, name] of [[QA_FIXTURE_IDS.visibleFolder, "QA visible fixture"], [QA_FIXTURE_IDS.hiddenFolder, "QA restricted fixture"]]) {
    batch.set(firestore.collection("housePlannerFolders").doc(id), { projectId: QA_PRIMARY_PROJECT, name, parentId: null, createdAt: timestamp, createdBy: users[0].email, qaFixtureVersion: QA_FIXTURE_VERSION });
  }
  for (const [id, projectId, folderId, text] of [
    [QA_FIXTURE_IDS.visibleDocument, QA_PRIMARY_PROJECT, QA_FIXTURE_IDS.visibleFolder, "QA visible document: synthetic data only."],
    [QA_FIXTURE_IDS.hiddenDocument, QA_PRIMARY_PROJECT, QA_FIXTURE_IDS.hiddenFolder, "QA hidden document: synthetic data only."],
    [QA_FIXTURE_IDS.isolationDocument, QA_ISOLATION_PROJECT, null, "QA isolation document: synthetic data only."],
  ]) {
    const objectKey = `house-planner/projects/${projectId}/qa-fixtures/${id}.txt`;
    const bytes = Buffer.from(text);
    await bucket.file(objectKey).save(bytes, { resumable: false, contentType: "text/plain" });
    batch.set(firestore.collection("housePlannerDocuments").doc(id), { projectId, folderId, objectKey, fileName: `${id}.txt`, contentType: "text/plain", size: bytes.length, uploadedBy: users.find((user) => user.projectId === projectId && user.role === "admin").email, createdAt: timestamp, aiEnabled: false, qaFixtureVersion: QA_FIXTURE_VERSION });
  }
  for (const [id, projectId] of [[QA_FIXTURE_IDS.primaryNote, QA_PRIMARY_PROJECT], [QA_FIXTURE_IDS.isolationNote, QA_ISOLATION_PROJECT]]) {
    const owner = users.find((user) => user.projectId === projectId && user.role === "admin");
    batch.set(firestore.collection("housePlannerNotes").doc(id), { projectId, title: "QA synthetic permission fixture", content: `Synthetic note for ${projectId}.`, aiEnabled: false, createdBy: owner.email, updatedBy: owner.email, createdAt: timestamp, updatedAt: timestamp, qaFixtureVersion: QA_FIXTURE_VERSION });
  }
  await batch.commit();
  return { fixtureVersion: QA_FIXTURE_VERSION, projectIds: [QA_PRIMARY_PROJECT, QA_ISOLATION_PROJECT], fixtures: QA_FIXTURE_IDS, users: users.map(({ key, email, uid, role, projectId }) => ({ key, email, uid, role, projectId })) };
}
