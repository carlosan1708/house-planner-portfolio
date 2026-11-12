export const ACTION_TOOLS = ["createPurchase", "recordPayment", "attachReceipt", "createReminder", "sendReminderConfirmation"] as const;
export type ActionTool = typeof ACTION_TOOLS[number];
export type AgentFields = Record<string, string | number | null>;
export type AgentAction = { tool: ActionTool; fields: AgentFields; labels: Record<string, string> };
export type AgentOutcome = { tool: ActionTool; id: string; href?: string; status?: "sent" | "uncertain" };
export type AgentPending =
  | { kind: "review"; action: AgentAction; question: string }
  | { kind: "input"; question: string; options: { id: string; label: string; suggested?: boolean }[] }
  | { kind: "retry"; question: string }
  | { kind: "continue"; question: string };
export type ImageProgress = { stage: "reading" | "analyzing" | "generating" | "saving"; current?: number; total?: number };
export type AgentRunView = { id: string; revision: number; pending: AgentPending | null; completed: AgentOutcome[]; active: boolean; imageWorkflow?: boolean; imageProgress?: ImageProgress };
export type AgentView = { href: string; label: string };
export const AGENT_FILE_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"] as const;
export const AGENT_FILE_LIMIT = 8 * 1024 * 1024;
export type AgentUpload = { id: string; name: string };

const confirmationFeedback = {
  email_unavailable: {
    en: "Your reminder was saved. Email is currently unavailable. You can retry sending the confirmation.",
    es: "Guardamos el recordatorio. El correo no está disponible en este momento. Podés reintentar el envío de la confirmación.",
  },
  email_rejected: {
    en: "Your reminder was saved. The confirmation email could not be sent. You can retry sending it.",
    es: "Guardamos el recordatorio. No se pudo enviar el correo de confirmación. Podés reintentar el envío.",
  },
} as const;

export function formatAssistantActionFeedback(text: string, language: "en" | "es") {
  // Older conversations can contain a saved error code followed by a source note.
  const firstParagraph = text.split("\n\n", 1)[0];
  if (!Object.hasOwn(confirmationFeedback, firstParagraph)) return text;
  return confirmationFeedback[firstParagraph as keyof typeof confirmationFeedback][language] + text.slice(firstParagraph.length);
}
