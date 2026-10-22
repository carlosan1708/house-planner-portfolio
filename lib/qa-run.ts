import { FieldValue, Timestamp } from "firebase-admin/firestore";
import type { MemberRecord } from "./project";
import { firestore } from "./firebase-admin";
import { PROJECTS } from "./project";
import { assertQaWorkspace } from "./qa-reset";

export const QA_RUN_LEASE_MS = 90 * 60 * 1000;
export type QaRunSuite = "smoke" | "full" | "cleanup";

export function normalizeQaRunId(value: unknown) {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{8,100}$/.test(value) ? value : "";
}

export function normalizeQaRunSuite(value: unknown): QaRunSuite | null {
  return value === "smoke" || value === "full" || value === "cleanup" ? value : null;
}

export function qaRunLeaseAvailable(currentRunId: unknown, leaseUntilMs: number, requestedRunId: string, now = Date.now()) {
  return !currentRunId || currentRunId === requestedRunId || leaseUntilMs <= now;
}

function millis(value: unknown) {
  return value && typeof value === "object" && "toMillis" in value
    ? Number((value as FirebaseFirestore.Timestamp).toMillis())
    : 0;
}

export async function acquireQaRun(actor: MemberRecord, runId: string, suite: QaRunSuite, aiEnabled = false) {
  await assertQaWorkspace(actor);
  const ref = firestore.collection(PROJECTS).doc(actor.projectId);
  const budgetRef = firestore.collection("housePlannerQaControls").doc("budget");
  const now = Date.now();
  await firestore.runTransaction(async (transaction) => {
    const [project, budget] = await transaction.getAll(ref, budgetRef);
    if (budget.data()?.cutoffPeriod === new Date(now).toISOString().slice(0, 7)) throw new Error("qa_budget_cutoff");
    const data = project.data();
    if (!project.exists || data?.ownerUid !== actor.uid) throw new Error("qa_project_mismatch");
    if (!qaRunLeaseAvailable(data?.qaRegressionRunId, millis(data?.qaRegressionLeaseUntil), runId, now)) throw new Error("qa_run_in_progress");
    transaction.set(ref, {
      qaRegressionRunId: runId,
      qaRegressionSuite: suite,
      qaRegressionStartedAt: FieldValue.serverTimestamp(),
      qaRegressionLeaseUntil: Timestamp.fromMillis(now + QA_RUN_LEASE_MS),
      qaRegressionStartedBy: actor.email,
      qaRegressionAiEnabled: aiEnabled,
    }, { merge: true });
  });
  return { runId, suite, aiEnabled, leaseUntil: new Date(now + QA_RUN_LEASE_MS).toISOString() };
}

export async function releaseQaRun(actor: MemberRecord, runId: string) {
  await assertQaWorkspace(actor);
  const ref = firestore.collection(PROJECTS).doc(actor.projectId);
  return firestore.runTransaction(async (transaction) => {
    const project = await transaction.get(ref);
    if (project.data()?.qaRegressionRunId !== runId) return false;
    transaction.set(ref, {
      qaRegressionRunId: FieldValue.delete(),
      qaRegressionSuite: FieldValue.delete(),
      qaRegressionStartedAt: FieldValue.delete(),
      qaRegressionLeaseUntil: FieldValue.delete(),
      qaRegressionStartedBy: FieldValue.delete(),
      qaRegressionAiEnabled: FieldValue.delete(),
      qaRegressionReleasedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return true;
  });
}

export async function qaRunStatus(actor: MemberRecord) {
  await assertQaWorkspace(actor);
  const project = await firestore.collection(PROJECTS).doc(actor.projectId).get();
  const data = project.data();
  const leaseUntilMs = millis(data?.qaRegressionLeaseUntil);
  return {
    active: Boolean(data?.qaRegressionRunId) && leaseUntilMs > Date.now(),
    runId: String(data?.qaRegressionRunId || ""),
    suite: normalizeQaRunSuite(data?.qaRegressionSuite),
    leaseUntil: leaseUntilMs ? new Date(leaseUntilMs).toISOString() : null,
  };
}
