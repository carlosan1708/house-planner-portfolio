import type { GenerateContentParameters, GenerateContentResponse } from "@google/genai";
import { FieldValue } from "firebase-admin/firestore";
import { firestore } from "./firebase-admin";
import { QA_PRIMARY_PROJECT } from "./qa-environment.mjs";
import { PROJECTS } from "./project";
import { boundedQaAiRequest, qaAiPolicy } from "./qa-ai-policy";

export async function generateQaAiContent(request: GenerateContentParameters, generate: (request: GenerateContentParameters) => Promise<GenerateContentResponse>, countTokens: (request: GenerateContentParameters) => Promise<number | undefined>) {
  const boundedRequest = boundedQaAiRequest(request);
  const policy = qaAiPolicy();
  const month = new Date().toISOString().slice(0, 7);
  const projectRef = firestore.collection(PROJECTS).doc(QA_PRIMARY_PROJECT);
  const monthRef = firestore.collection("housePlannerQaAiUsage").doc(month);
  const budgetRef = firestore.collection("housePlannerQaControls").doc("budget");
  await firestore.runTransaction(async (transaction) => {
    const [project, monthly, budget] = await transaction.getAll(projectRef, monthRef, budgetRef);
    if (budget.data()?.cutoffPeriod === month) throw new Error("qa_budget_cutoff");
    const state = project.data();
    const runId = state?.qaRegressionRunId;
    const leaseUntil = state?.qaRegressionLeaseUntil?.toMillis?.() || 0;
    if (!runId || leaseUntil <= Date.now() || state?.qaRegressionAiEnabled !== true) throw new Error("qa_ai_requested_run_required");
    const calls = state?.qaAiRunId === runId ? Number(state.qaAiCalls || 0) : 0;
    const monthlyCalls = Number(monthly.data()?.calls || 0);
    if (calls >= policy.callLimit) throw new Error("qa_ai_run_call_limit");
    if (monthlyCalls >= policy.monthlyCallLimit) throw new Error("qa_ai_monthly_call_limit");
    transaction.set(projectRef, { qaAiRunId: runId, qaAiCalls: calls + 1 }, { merge: true });
    transaction.set(monthRef, { calls: monthlyCalls + 1, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  });
  // Reservations remain counted after failures, process restarts and fixture resets.
  const tokenCount = await countTokens(boundedRequest);
  if (!Number.isFinite(tokenCount) || tokenCount! < 0 || tokenCount! > policy.inputTokenLimit) throw new Error("qa_ai_input_token_limit");
  return generate(boundedRequest);
}
