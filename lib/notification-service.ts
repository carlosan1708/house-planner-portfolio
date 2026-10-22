import "server-only";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { firestore } from "./firebase-admin";
import { buildGmailMessage, countdownJobSpecs, normalizeNotificationLanguage, normalizeRecipientUids, type NotificationStage } from "./notifications";
import { gmailConfiguration, sendGmailMessage } from "./gmail";
import { COUNTDOWNS, MEMBERSHIPS, NOTIFICATION_DELIVERIES, NOTIFICATION_JOBS, NOTIFICATION_PREFERENCES, normalizePermissions, PROJECTS, USERS } from "./project";
import { resolveMembershipAccess } from "./access-links";

type JobData = {
  countdownId?: unknown;
  projectId?: unknown;
  stage?: unknown;
  runAt?: unknown;
  nextAttemptAt?: unknown;
  status?: unknown;
  attempts?: unknown;
  leaseUntil?: unknown;
};

function millis(value: unknown) {
  return value && typeof value === "object" && "toMillis" in value ? Number((value as FirebaseFirestore.Timestamp).toMillis()) : 0;
}

export async function eligibleCountdownRecipients(projectId: string) {
  const memberships = await firestore.collection(MEMBERSHIPS).where("projectId", "==", projectId).get();
  const resolved = await Promise.all(memberships.docs.map((document) => resolveMembershipAccess(document.data())));
  const approved = resolved.filter((data) => data.status === "approved" && (data.role === "admin" || normalizePermissions(data.permissions).plan));
  return Promise.all(approved.map(async (membership) => {
    const uid = String(membership.uid || "");
    const identity = uid ? await firestore.collection(USERS).doc(uid).get() : null;
    return {
      uid,
      name: String(identity?.data()?.name || identity?.data()?.email || "Project member"),
      email: String(identity?.data()?.email || ""),
      role: membership.role === "admin" || membership.role === "viewer" ? membership.role : "editor",
    };
  }));
}

export async function validateRecipientUids(projectId: string, value: unknown) {
  const requested = normalizeRecipientUids(value);
  if (!requested.length) return [];
  const eligible = new Set((await eligibleCountdownRecipients(projectId)).map((recipient) => recipient.uid));
  return requested.filter((uid) => eligible.has(uid));
}

export async function scheduleCountdownNotificationJobs({ countdownId, projectId, startedAtMs, dueAtMs }: {
  countdownId: string;
  projectId: string;
  startedAtMs: number;
  dueAtMs: number;
}) {
  const batch = firestore.batch();
  for (const spec of countdownJobSpecs(countdownId, startedAtMs, dueAtMs)) {
    batch.set(firestore.collection(NOTIFICATION_JOBS).doc(spec.id), {
      countdownId,
      projectId,
      stage: spec.stage,
      runAt: Timestamp.fromMillis(spec.runAtMs),
      status: "pending",
      attempts: 0,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  }
  await batch.commit();
}

export async function cancelCountdownNotificationJobs(countdownId: string) {
  const batch = firestore.batch();
  for (const stage of ["pre_due", "due"] as const) {
    batch.set(firestore.collection(NOTIFICATION_JOBS).doc(`${countdownId}__${stage}`), {
      status: "cancelled",
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  }
  await batch.commit();
}

function retryDelayMs(attempts: number) {
  return Math.min(3_600_000, 300_000 * Math.max(1, 2 ** Math.min(4, attempts)));
}

async function reserveJob(document: FirebaseFirestore.QueryDocumentSnapshot, now: number) {
  return firestore.runTransaction(async (transaction) => {
    const current = await transaction.get(document.ref);
    const data = current.data() as JobData | undefined;
    const activeLease = data?.status === "processing" && millis(data.leaseUntil) > now;
    if (!data || activeLease || (data.status !== "pending" && data.status !== "processing")) return false;
    transaction.set(document.ref, { status: "processing", leaseUntil: Timestamp.fromMillis(now + 240_000), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return true;
  });
}

async function reserveDelivery(deliveryId: string, jobId: string, uid: string, projectId: string, stage: NotificationStage) {
  const ref = firestore.collection(NOTIFICATION_DELIVERIES).doc(deliveryId);
  return firestore.runTransaction(async (transaction) => {
    const current = await transaction.get(ref);
    const status = current.data()?.status;
    if (status === "delivered" || status === "skipped" || status === "sending" || status === "uncertain") return null;
    transaction.set(ref, { jobId, uid, projectId, stage, status: "sending", attempts: Number(current.data()?.attempts || 0) + 1, updatedAt: FieldValue.serverTimestamp(), createdAt: current.exists ? current.data()?.createdAt : FieldValue.serverTimestamp() }, { merge: true });
    return ref;
  });
}

async function processJob(document: FirebaseFirestore.QueryDocumentSnapshot, now: number) {
  const data = document.data() as JobData;
  const countdownId = String(data.countdownId || "");
  const projectId = String(data.projectId || "");
  const stage: NotificationStage = data.stage === "pre_due" ? "pre_due" : "due";
  const [countdown, project] = await Promise.all([
    firestore.collection(COUNTDOWNS).doc(countdownId).get(),
    firestore.collection(PROJECTS).doc(projectId).get(),
  ]);
  if (!countdown.exists || countdown.data()?.projectId !== projectId || countdown.data()?.completed === true) {
    await document.ref.set({ status: "cancelled", leaseUntil: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return { delivered: 0, skipped: 0, failed: 0 };
  }
  const countdownData = countdown.data()!;
  const dueAtMs = millis(countdownData.dueAt);
  const recipients = normalizeRecipientUids(countdownData.recipientUids).length
    ? normalizeRecipientUids(countdownData.recipientUids)
    : normalizeRecipientUids([countdownData.createdByUid]);
  const eligible = new Map((await eligibleCountdownRecipients(projectId)).map((recipient) => [recipient.uid, recipient]));
  const acknowledged = new Set(normalizeRecipientUids(countdownData.acknowledgedByUids));
  const publicUrl = (process.env.HOUSE_PLANNER_PUBLIC_URL || "").replace(/\/$/, "");
  const projectName = String(project.data()?.name || "House Planner");
  const gmail = gmailConfiguration();
  if (!gmail.configured) {
    await document.ref.set({ status: "pending", nextAttemptAt: Timestamp.fromMillis(now + 21_600_000), leaseUntil: FieldValue.delete(), lastError: "gmail-not-configured", updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return { delivered: 0, skipped: 0, failed: 1 };
  }
  let delivered = 0; let skipped = 0; let failed = 0;
  for (const uid of recipients) {
    const recipient = eligible.get(uid);
    const deliveryId = `${document.id}__${uid}`;
    if (!recipient?.email || (stage === "due" && acknowledged.has(uid))) {
      await firestore.collection(NOTIFICATION_DELIVERIES).doc(deliveryId).set({ jobId: document.id, uid, projectId, stage, status: "skipped", reason: recipient?.email ? "acknowledged" : "ineligible", updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      skipped += 1;
      continue;
    }
    const preference = await firestore.collection(NOTIFICATION_PREFERENCES).doc(uid).get();
    if (preference.data()?.emailEnabled === false) {
      await firestore.collection(NOTIFICATION_DELIVERIES).doc(deliveryId).set({ jobId: document.id, uid, projectId, stage, status: "skipped", reason: "disabled", updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      skipped += 1;
      continue;
    }
    const deliveryRef = await reserveDelivery(deliveryId, document.id, uid, projectId, stage);
    if (!deliveryRef) { skipped += 1; continue; }
    const link = `${publicUrl}/?project=${encodeURIComponent(projectId)}&section=plan&countdown=${encodeURIComponent(countdownId)}`;
    const raw = buildGmailMessage({
      from: gmail.sender,
      to: recipient.email,
      projectName,
      title: String(countdownData.title || "Reminder"),
      dueAt: new Date(dueAtMs),
      stage,
      language: normalizeNotificationLanguage(preference.data()?.language),
      link,
      deliveryId,
    });
    try {
      const gmailMessageId = await sendGmailMessage(raw);
      await deliveryRef.set({ status: "delivered", gmailMessageId, deliveredAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      delivered += 1;
    } catch (error) {
      const status = typeof error === "object" && error && "response" in error ? Number((error as { response?: { status?: number } }).response?.status || 0) : 0;
      const retryable = status === 429 || status >= 500;
      await deliveryRef.set({ status: retryable ? "failed" : "uncertain", errorCode: status || "gmail-error", updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      failed += 1;
    }
  }
  const attempts = Number(data.attempts || 0) + 1;
  await document.ref.set(failed ? {
    status: "pending",
    attempts,
    nextAttemptAt: Timestamp.fromMillis(now + retryDelayMs(attempts)),
    leaseUntil: FieldValue.delete(),
    updatedAt: FieldValue.serverTimestamp(),
  } : {
    status: "complete",
    attempts,
    completedAt: FieldValue.serverTimestamp(),
    leaseUntil: FieldValue.delete(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  return { delivered, skipped, failed };
}

export async function dispatchDueNotificationJobs(now = Date.now()) {
  const snapshot = await firestore.collection(NOTIFICATION_JOBS).get();
  const candidates = snapshot.docs.filter((document) => {
    const data = document.data() as JobData;
    const status = String(data.status || "");
    const runnable = status === "pending" || (status === "processing" && millis(data.leaseUntil) <= now);
    return runnable && millis(data.runAt) <= now && (!millis(data.nextAttemptAt) || millis(data.nextAttemptAt) <= now);
  }).sort((a, b) => millis(a.data().runAt) - millis(b.data().runAt)).slice(0, 50);
  const total = { jobs: 0, delivered: 0, skipped: 0, failed: 0 };
  for (const job of candidates) {
    if (!await reserveJob(job, now)) continue;
    const result = await processJob(job, now);
    total.jobs += 1;
    total.delivered += result.delivered;
    total.skipped += result.skipped;
    total.failed += result.failed;
  }
  return total;
}
