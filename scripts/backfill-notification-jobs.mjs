import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";

const projectId = process.env.GOOGLE_CLOUD_PROJECT || "example-house-planner";
const app = getApps()[0] || initializeApp({ credential: applicationDefault(), projectId });
const db = getFirestore(app);
const now = Date.now();
const dayMs = 86_400_000;
const countdowns = await db.collection("housePlannerCountdowns").get();
let batch = db.batch();
let operations = 0;
let migrated = 0;

async function commitIfNeeded(force = false) {
  if (!operations || (!force && operations < 400)) return;
  await batch.commit();
  batch = db.batch();
  operations = 0;
}

for (const countdown of countdowns.docs) {
  const data = countdown.data();
  const dueAtMs = data.dueAt?.toMillis?.() || 0;
  const startedAtMs = data.startedAt?.toMillis?.() || 0;
  const createdByUid = typeof data.createdByUid === "string" ? data.createdByUid : "";
  const projectIdValue = typeof data.projectId === "string" ? data.projectId : "";
  if (!createdByUid || !projectIdValue || dueAtMs <= now) continue;
  const project = await db.collection("housePlannerProjects").doc(projectIdValue).get();
  if (!project.exists || project.data()?.kind === "personal") continue;
  const recipientUids = Array.isArray(data.recipientUids) && data.recipientUids.length ? data.recipientUids : [createdByUid];
  batch.set(countdown.ref, { recipientUids, notificationMigratedAt: FieldValue.serverTimestamp() }, { merge: true });
  operations += 1;
  const specs = [{ id: `${countdown.id}__due`, stage: "due", runAtMs: dueAtMs }];
  if (dueAtMs - Math.max(startedAtMs, now) > dayMs) specs.unshift({ id: `${countdown.id}__pre_due`, stage: "pre_due", runAtMs: dueAtMs - dayMs });
  for (const spec of specs) {
    batch.set(db.collection("housePlannerNotificationJobs").doc(spec.id), {
      countdownId: countdown.id,
      projectId: projectIdValue,
      stage: spec.stage,
      runAt: Timestamp.fromMillis(spec.runAtMs),
      status: "pending",
      attempts: 0,
      migratedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    operations += 1;
  }
  migrated += 1;
  await commitIfNeeded();
}
await commitIfNeeded(true);
process.stdout.write(`Migrated ${migrated} future shared-project countdown(s).\n`);
