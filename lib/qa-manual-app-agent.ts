import { GenerateContentResponse, type Content, type FunctionCall } from "@google/genai";
import { firestore } from "./firebase-admin";
import { PROJECTS, type MemberRecord } from "./project";
import { QA_PRIMARY_PROJECT, resolveFirebaseEnvironment } from "./qa-environment.mjs";

export function manualAppAgentEnabled(actor: MemberRecord) {
  return process.env.QA_MANUAL_APP_AGENT === "1" && actor.projectId === QA_PRIMARY_PROJECT &&
    resolveFirebaseEnvironment().isEmulator;
}

export async function manualAppAgentResponse(contents: Content[]) {
  const project = (await firestore.collection(PROJECTS).doc(QA_PRIMARY_PROJECT).get()).data();
  if (!String(project?.qaRegressionRunId || "").startsWith("manual-agent-") ||
      (project?.qaRegressionLeaseUntil?.toMillis() || 0) <= Date.now()) throw new Error("qa_manual_lease_required");
  const input = contents.at(-1)?.parts || [];
  const message = input.find((part) => part.text)?.text || "";
  const output = input.find((part) => part.functionResponse)?.functionResponse;
  let call: FunctionCall | undefined;
  let text = "Manual QA fixture supports the requests listed in the app-agent checklist.";
  if (output?.response?.error) text = "The app denied or could not complete that operation.";
  else if (output?.name === "findPayments") {
    if (message) throw new Error("qa_manual_unexpected_model_input");
    const original = [...contents].reverse().flatMap((item) => item.parts || []).find((part) => part.text)?.text || "";
    if (original.startsWith("Record a payment")) call = { name: "recordPayment", args: {
      amount: 85000, expectedCurrency: "CRC", paymentDate: "2026-11-11", payee: "QA Manual Supplier", paymentKind: "partial",
    } };
    else text = `The ledger returned ${Number(output.response?.count || 0)} matching payments.`;
  } else if (output?.name === "createReminder") {
    if (typeof output.response?.id === "string") call = { name: "sendReminderConfirmation", args: { reminderId: output.response.id } };
  } else if (message.includes("completedActions") && message.includes('"recordPayment"')) text = "The approved payment is saved.";
  else if (message.startsWith("Record a payment") || message.startsWith("Find payments")) {
    call = { name: "findPayments", args: { vendor: "QA Manual Supplier" } };
  } else if (message.startsWith("Create a reminder")) {
    call = { name: "createReminder", args: { description: "QA Manual Supplier follow-up", dueDate: "2099-04-03", currency: "CRC" } };
  }
  const response = new GenerateContentResponse();
  response.candidates = [{ content: { role: "model", parts: call ? [{ functionCall: call }] : [{ text }] } }];
  return response;
}
