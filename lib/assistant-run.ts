import { createHash, randomUUID } from "node:crypto";
import type { AssistantCitation } from "./assistant";
import { assistantSourceToken, readableAssistantSources } from "./rag-search";
import type { MemberRecord } from "./project";
import { formatAssistantActionFeedback, type AgentAction, type AgentFields } from "./assistant-run-types";
import { actionFields, applyAgentAction, duplicateFinancialRecords, expenseEditor, liveAgent, prepareAction, ToolFailure } from "./assistant-app-tools";
import { agentId, changeRun, checkpoint, checkRun, claimExecution, claimPlanning, readRun, RunConflict, SourceChanged, type Run } from "./assistant-run-store";

type Conversation = FirebaseFirestore.DocumentReference;
const todayInCostaRica = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Costa_Rica", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
export const agentToday = todayInCostaRica;
const normalized = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

function negativeIntent(words: string) {
  return /\b(?:don.?t|do not|never|without|no me|no (?:envies|mandes|crees)|sin (?:correo|confirmacion))\b/.test(words);
}

export function requestedConfirmation(goal: string) {
  if (negativeIntent(normalized(goal))) return false;
  return /\b(?:email|e-mail|correo)\b/.test(normalized(goal)) && /\b(?:confirm(?:ation|ar|acion)?|confirmame|confirma)\b/.test(normalized(goal));
}

export function directlyRequestedDate(goal: string, dueDate: unknown, today = todayInCostaRica()) {
  if (typeof dueDate !== "string") return false;
  const words = normalized(goal);
  if (negativeIntent(words) || !/\b(?:remind|reminder|recuerdame|recordatorio)\b/.test(words) ||
      /\b(?:\d{1,2}:\d\d|\d{1,2}\s*(?:am|pm|a\.\s*m\.|p\.\s*m\.)|a las|at \d|next|proximo|proxima|scheduled email)\b/.test(words)) return false;
  const dates = words.match(/\b\d{4}-\d\d-\d\d\b/g);
  if (dates?.length) return dates.length === 1 && dates[0] === dueDate;
  const weekdays = ["sunday|domingo", "monday|lunes", "tuesday|martes", "wednesday|miercoles", "thursday|jueves", "friday|viernes", "saturday|sabado"];
  const matchingDays = weekdays.flatMap((day, index) => new RegExp(`\\b(?:${day})\\b`).test(words) ? [index] : []);
  const date = new Date(today + "T00:00:00Z");
  if (/\b(?:today|hoy)\b/.test(words) && !matchingDays.length) return today === dueDate;
  if (/\b(?:tomorrow|manana)\b/.test(words) && !matchingDays.length) date.setUTCDate(date.getUTCDate() + 1);
  else if (matchingDays.length === 1) date.setUTCDate(date.getUTCDate() + ((matchingDays[0] - date.getUTCDay() + 7) % 7));
  else return false;
  return date.toISOString().slice(0, 10) === dueDate;
}

export async function validSources(actor: MemberRecord, sources: AssistantCitation[]) {
  if (!sources.length) return true;
  const allowed = await readableAssistantSources(actor, sources);
  return sources.every((citation) => allowed.has(assistantSourceToken(citation)));
}

function actionKey(action: AgentAction) {
  const sorted = Object.entries(action.fields).sort(([left], [right]) => left.localeCompare(right));
  return createHash("sha256").update(JSON.stringify([action.tool, sorted])).digest("hex");
}

export async function visibleRun(actor: MemberRecord, run: Run | null) {
  if (!run || !expenseEditor(actor) || !actor.projectMembershipVerified || actor.anonymousLink) return null;
  if (await validSources(actor, run.sources)) return run;
  return { ...run, pending: { kind: "continue" as const, question: run.language === "es" ? "Una fuente cambió. Retomá la consulta con las fuentes actuales." : "A source changed. Resume to check the current sources." }, completed: [] };
}

export async function proposeAgentAction(actor: MemberRecord, conversation: Conversation, run: Run, tool: AgentAction["tool"], args: Record<string, unknown>, sources: AssistantCitation[]) {
  const live = await liveAgent(actor);
  const merged = new Map([...run.sources, ...sources].map((citation) => [assistantSourceToken(citation), citation]));
  const dependencies = [...merged.values()].slice(0, 100);
  if (!await validSources(live, dependencies)) throw new SourceChanged("source_changed");
  const { action, targets } = await prepareAction(live, run, tool, args);
  const repeated = run.completed.find((item) => item.key === actionKey(action) ||
    (tool === "sendReminderConfirmation" && item.tool === tool && item.id === action.fields.reminderId));
  if (repeated) return { run, outcome: repeated };
  if (tool === "recordPayment" || tool === "createPurchase") {
    const candidates = await duplicateFinancialRecords(live, action);
    const override = `new-${actionKey(action)}`;
    if (candidates.length && !run.answer?.endsWith(`(selected record ID: ${override})`)) {
      const chosen = candidates.find((item) => run.answer?.endsWith(`(selected record ID: ${item.id})`));
      if (chosen) throw new RunConflict("use_selected_existing_record");
      const spanish = run.language === "es";
      const pending = {
        kind: "input" as const,
        question: spanish ? "Encontré registros parecidos. ¿Usamos uno existente o creamos otro?" : "I found similar records. Use one of these or create a separate record?",
        options: [...candidates, { id: override, label: spanish ? "Crear otro registro" : "Create a separate record" }],
      };
      return { run: await checkpoint(conversation, live, run, { status: "input", pending, sources: dependencies }), outcome: null };
    }
  }
  if (tool === "sendReminderConfirmation" && (!requestedConfirmation(run.goal) ||
      !run.completed.some((item) => item.tool === "createReminder" && item.id === action.fields.reminderId))) {
    throw new RunConflict("email_confirmation_not_requested");
  }
  const direct = tool === "sendReminderConfirmation" || (tool === "createReminder" && directlyRequestedDate(run.goal, action.fields.dueDate));
  if (!direct) return { run: await checkpoint(conversation, live, run, {
    status: "review", action, targets, operationId: randomUUID(), sources: dependencies,
    pending: { kind: "review", action, question: run.language === "es" ? "Revisá los datos antes de guardar." : "Review the details before saving." },
  }), outcome: null };
  const executing = await checkpoint(conversation, live, run, {
    ...claimExecution(run), action, targets, operationId: randomUUID(), sources: dependencies,
  });
  return executeRunAction(live, conversation, executing, true);
}

export async function requestRunInput(actor: MemberRecord, conversation: Conversation, run: Run, args: Record<string, unknown>, sources: AssistantCitation[]) {
  const question = typeof args.question === "string" ? args.question.trim().slice(0, 500) : "";
  if (!question) throw new RunConflict("missing_question");
  const options = Array.isArray(args.options) ? args.options.flatMap((option: unknown) => {
    if (!option || typeof option !== "object" || !("id" in option) || !("label" in option) || !agentId(option.id) || typeof option.label !== "string") return [];
    return [{ id: option.id, label: option.label.slice(0, 180) }];
  }).slice(0, 12) : [];
  const merged = new Map([...run.sources, ...sources].map((citation) => [assistantSourceToken(citation), citation]));
  return checkpoint(conversation, actor, run, { status: "input", pending: { kind: "input", question, options }, sources: [...merged.values()].slice(0, 100) });
}

async function executeRunAction(actor: MemberRecord, conversation: Conversation, run: Run, keepPlanning: boolean) {
  try {
    const live = await liveAgent(actor);
    if (!await validSources(live, run.sources)) throw new SourceChanged("source_changed");
    const outcome = await applyAgentAction(live, conversation, run);
    const next = await checkpoint(conversation, live, run, {
      ...(keepPlanning ? claimPlanning(run) : { status: "ready", pending: { kind: "continue", question: "" } }),
      action: null, targets: [], operationId: null, lastTool: outcome.tool, completed: [...run.completed, { ...outcome, key: actionKey(run.action!) }],
    });
    return { run: next, outcome };
  } catch (error) {
    if (error instanceof RunConflict) throw error;
    const stale = error instanceof SourceChanged || (error instanceof ToolFailure && !error.retryable);
    const question = error instanceof ToolFailure ? formatAssistantActionFeedback(error.code, run.language) : stale ? (run.language === "es" ? "Cambió un dato. Revisá la acción de nuevo." : "A record or source changed. Review the action again.") : "";
    const next = await checkpoint(conversation, actor, run, stale
      ? { status: "ready", action: null, targets: [], operationId: null, sources: [], pending: { kind: "continue", question } }
      : { status: "retry", pending: { kind: "retry", question } });
    return { run: next, outcome: null };
  }
}

export type RunResponse = { id: string; revision: number; action: "answer" | "approve" | "retry" | "continue" | "cancel" | "save"; answer?: string; fields?: AgentFields };

export async function respondToRun(actor: MemberRecord, conversation: Conversation, input: RunResponse) {
  const live = await liveAgent(actor);
  const before = await readRun(conversation);
  const sourceChanged = Boolean(before?.sources.length && !await validSources(live, before.sources));
  const run = await changeRun(conversation, live, (current) => {
    const state = checkRun(current, input);
    const expired = state.leaseUntil < Date.now();
    if (input.action === "cancel") return { ...state, status: "complete", pending: null, action: null, operationId: null, sources: [], targets: [], answer: null };
    if (!expenseEditor(live)) throw new RunConflict("expenses_editor_access_required");
    if (sourceChanged) {
      if (input.action !== "continue") throw new RunConflict("source_changed");
      return { ...claimPlanning(state), sources: [], answer: null, action: null, operationId: null, targets: [] };
    }
    if (input.action === "answer" && state.status === "input" && state.pending?.kind === "input") {
      const answer = input.answer?.trim().slice(0, 1000);
      if (!answer || (state.pending.options.length && !state.pending.options.some((option) => option.id === answer))) throw new RunConflict("invalid_answer");
      const choice = state.pending.options.find((option) => option.id === answer);
      return { ...claimPlanning(state), answer: choice ? `${choice.label} (selected record ID: ${choice.id})` : answer };
    }
    if ((input.action === "approve" || input.action === "save") && state.status === "review" && state.action) {
      const changed = input.fields || {};
      for (const field of Object.keys(changed)) {
        if (!Object.hasOwn(state.action.fields, field) || field.endsWith("Id") || field === "expectedCurrency" || field === "currency") {
          throw new RunConflict("invalid_review_fields");
        }
      }
      const fields = actionFields(state.action.tool, { ...state.action.fields, ...changed });
      const action = { ...state.action, fields };
      if (input.action === "save" && state.pending?.kind === "review") return { ...state, action, pending: { ...state.pending, action } };
      return { ...claimExecution(state), action };
    }
    if (input.action === "retry" && (state.status === "retry" || (state.status === "executing" && expired))) return claimExecution(state);
    if (input.action === "continue" && (state.status === "ready" || (state.status === "planning" && expired))) return claimPlanning(state);
    throw new RunConflict("run_changed");
  });
  if (run.status !== "executing") return run;
  return (await executeRunAction(live, conversation, run, false)).run;
}
