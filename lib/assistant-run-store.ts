import { randomUUID } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { firestore } from "./firebase-admin";
import { AGENT_CONVERSATIONS, type MemberRecord } from "./project";
import type { AssistantCitation } from "./assistant";
import type { AgentAction, AgentOutcome, AgentPending, AgentRunView, ImageProgress } from "./assistant-run-types";
import type { AgentWrite } from "./agent-write";
import type { PlanRef } from "./assistant-plan-sources";
import type { SheetEvidence } from "./assistant-image-model";

export type Run = {
  id: string;
  revision: number;
  goal: string;
  language: "en" | "es";
  status: "planning" | "review" | "input" | "executing" | "retry" | "ready" | "complete";
  pending: AgentPending | null;
  completed: Array<AgentOutcome & { key: string }>;
  action: AgentAction | null;
  operationId: string | null;
  sources: AssistantCitation[];
  uploads: string[];
  targets: TargetVersion[];
  answer: string | null;
  leaseUntil: number;
  lastTool: string | null;
  image?: { plan: PlanRef | null; choices: Record<string, string>; pageCount: number; evidence: SheetEvidence[]; progress?: ImageProgress } | null;
};
export type TargetVersion = { collection: string; id: string; version: string };
export const agentId = (id: unknown): id is string => typeof id === "string" && /^[a-zA-Z0-9:_-]{1,150}$/.test(id);
export const conversationRef = (id: string) => firestore.collection(AGENT_CONVERSATIONS).doc(id);
const runRef = (conversation: FirebaseFirestore.DocumentReference) => conversation.collection("runs").doc("current");
const lease = () => Date.now() + 300_000;
export const recordVersion = (snapshot: FirebaseFirestore.DocumentSnapshot) =>
  snapshot.updateTime ? `${snapshot.updateTime.seconds}:${snapshot.updateTime.nanoseconds}` : "";

export class RunConflict extends Error {}
export class SourceChanged extends Error {}

export function ownsConversation(data: FirebaseFirestore.DocumentData | undefined, actor: MemberRecord) {
  return !!data && !data.deletedAt && data.projectId === actor.projectId && data.createdByUid === actor.uid;
}

export function runView(run: Run | null): AgentRunView | null {
  if (!run) return null;
  let pending = run.pending;
  if (run.leaseUntil < Date.now()) {
    if (run.status === "planning") pending = { kind: "continue", question: "" };
    if (run.status === "executing") pending = { kind: "retry", question: run.image
      ? run.language === "es" ? "La generación se interrumpió. Podés reintentar con el mismo plano." : "Generation was interrupted. You can retry with the same plan."
      : "" };
  }
  return { id: run.id, revision: run.revision, pending, completed: run.completed.map(({ key, ...outcome }) => { void key; return outcome; }),
    active: run.status !== "complete",
    ...(run.image ? { imageWorkflow: true, ...(run.status === "executing" && !pending ? { imageProgress: run.image.progress ?? { stage: "reading" } } : {}) } : {}) };
}

export async function readRun(conversation: FirebaseFirestore.DocumentReference) {
  const snapshot = await runRef(conversation).get();
  return snapshot.exists ? snapshot.data() as Run : null;
}

export async function changeRun(conversation: FirebaseFirestore.DocumentReference, actor: MemberRecord, change: (current: Run | null) => Run, write?: (tx: FirebaseFirestore.Transaction, run: Run) => void) {
  const ref = runRef(conversation);
  return firestore.runTransaction(async (tx) => {
    const [thread, snap] = await Promise.all([tx.get(conversation), tx.get(ref)]);
    if (!ownsConversation(thread.data(), actor)) throw new RunConflict("conversation_not_found");
    const old = snap.exists ? snap.data() as Run : null;
    const next = change(old);
    next.revision = (old?.revision || 0) + 1;
    tx.set(ref, next);
    write?.(tx, next);
    return next;
  });
}

export function checkRun(current: Run | null, expected: { id: string; revision: number }) {
  if (!current || current.id !== expected.id || current.revision !== expected.revision) throw new RunConflict("run_changed");
  return current;
}

export async function startRun(conversation: FirebaseFirestore.DocumentReference, actor: MemberRecord, goal: string, language: Run["language"], uploads: string[]) {
  return changeRun(conversation, actor, (current) => {
    if (current && current.status !== "complete") throw new RunConflict("run_pending");
    return {
      id: randomUUID(), revision: 0, goal, language, status: "planning", pending: null, completed: [], action: null,
      operationId: null, sources: [], uploads, targets: [], answer: null, leaseUntil: lease(), lastTool: null,
    };
  });
}

export async function checkpoint(conversation: FirebaseFirestore.DocumentReference, actor: MemberRecord, expected: Run, fields: Partial<Run>) {
  return changeRun(conversation, actor, (current) => ({ ...checkRun(current, expected), ...fields }));
}

export function claimExecution(run: Run): Run {
  return { ...run, status: "executing", pending: null, leaseUntil: lease() };
}

export function claimPlanning(run: Run): Run {
  return { ...run, status: "planning", pending: null, leaseUntil: lease() };
}

export function operationRef(conversation: FirebaseFirestore.DocumentReference, operationId: string) {
  return conversation.collection("operations").doc(operationId);
}

export function businessWrite(actor: MemberRecord, conversation: FirebaseFirestore.DocumentReference, run: Run, operationId: string, targets = run.targets): AgentWrite {
  const operation = operationRef(conversation, operationId);
  return {
    validate: async (tx) => {
      const [thread, state, result] = await Promise.all([tx.get(conversation), tx.get(runRef(conversation)), tx.get(operation)]);
      if (!ownsConversation(thread.data(), actor)) throw new RunConflict("conversation_not_found");
      const current = checkRun(state.data() as Run | null, run);
      if (current.status !== "executing" || result.exists) throw new RunConflict("operation_claimed");
      for (const target of targets) {
        const snapshot = await tx.get(firestore.collection(target.collection).doc(target.id));
        if (snapshot.data()?.projectId !== actor.projectId || snapshot.data()?.deletedAt || recordVersion(snapshot) !== target.version) {
          throw new SourceChanged("target_changed");
        }
      }
    },
    record: (tx, id) => { tx.create(operation, { id, createdAt: FieldValue.serverTimestamp() }); },
  };
}
