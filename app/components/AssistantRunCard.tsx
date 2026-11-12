"use client";

import { useState } from "react";
import { formatAssistantActionFeedback, type ActionTool, type AgentFields, type AgentOutcome, type AgentPending, type AgentRunView } from "@/lib/assistant-run-types";

import { workspacePathWithLanguage } from "@/lib/workspace-navigation";

type Props = {
  run: AgentRunView;
  language: "en" | "es";
  busy: boolean;
  onRespond: (action: "answer" | "approve" | "retry" | "continue" | "cancel" | "save", input?: { answer?: string; fields?: AgentFields }) => void;
};
const titles: Record<ActionTool, [string, string]> = {
  createPurchase: ["Purchase", "Compra"],
  recordPayment: ["Payment", "Pago"],
  attachReceipt: ["Receipt attachment", "Vínculo del comprobante"],
  createReminder: ["In-app reminder", "Recordatorio en la aplicación"],
  sendReminderConfirmation: ["Confirmation email", "Correo de confirmación"],
};
const labels: Record<string, [string, string]> = {
  title: ["Title", "Título"], amount: ["Amount", "Monto"], currency: ["Currency", "Moneda"], expectedCurrency: ["Currency", "Moneda"],
  purchaseDate: ["Purchase date", "Fecha de compra"], paymentDate: ["Payment date", "Fecha de pago"], dueDate: ["Due date", "Fecha prevista"],
  vendor: ["Supplier", "Proveedor"], payee: ["Payee", "Beneficiario"], reference: ["Reference", "Referencia"], description: ["Description", "Descripción"],
  paymentKind: ["Payment type", "Tipo de pago"], budgetLineId: ["Budget line", "Partida"], purchaseId: ["Purchase", "Compra"],
  paymentId: ["Payment", "Pago"], receiptId: ["Receipt", "Comprobante"], uploadId: ["Attached file", "Archivo adjunto"],
};

export default function AssistantRunCard(props: Props) {
  const { run, language, busy, onRespond } = props;
  const t = (en: string, es: string) => language === "es" ? es : en;
  if (!run.active && !run.completed.length) return null;
  return <section className="assistant-proposal assistant-run" aria-label={t("Assistant actions", "Acciones del asistente")}>
    <AssistantActionResults actions={run.completed} language={language} />
    {run.pending && <PendingAction key={`${run.id}:${run.revision}`} pending={run.pending} {...props} />}
    {run.active && <button type="button" className="assistant-open-draft" disabled={busy} onClick={() => onRespond("cancel")}>{t("Cancel unfinished work", "Cancelar acciones pendientes")}</button>}
  </section>;
}

export function AssistantActionResults({ actions, language }: { actions: AgentOutcome[]; language: Props["language"] }) {
  const t = (en: string, es: string) => language === "es" ? es : en;
  if (!actions.length) return null;
  return <ul className="assistant-action-results">
    {actions.map((item) => <li key={`${item.tool}:${item.id}`}>
      {item.href ? <a href={workspacePathWithLanguage(item.href, language)}>{t(...titles[item.tool])}</a> : t(...titles[item.tool])}
      {" · "}{item.status === "uncertain" ? t("Delivery uncertain", "Entrega incierta") : item.status === "sent" ? t("Sent", "Enviado") : t("Saved", "Guardado")}
    </li>)}
  </ul>;
}

function PendingAction({ pending, language, busy, onRespond }: Props & { pending: AgentPending }) {
  const t = (en: string, es: string) => language === "es" ? es : en;
  const [answer, setAnswer] = useState("");
  const [edits, setEdits] = useState<AgentFields>({});
  if (pending.kind === "review") {
    const { action } = pending;
    return <>
      <strong>{t(...titles[action.tool])}</strong>
      {pending.question && <p>{pending.question}</p>}
      <form onSubmit={(event) => { event.preventDefault(); onRespond("approve", { fields: edits }); }}>
        {Object.entries(action.fields).map(([field, value]) => {
          const name = t(...(labels[field] || [field, field]));
          const current = edits[field] ?? value ?? "";
          const change = (value: string) => setEdits((previous) => ({ ...previous, [field]: field === "amount" && value !== "" ? Number(value) : value }));
          if (field.endsWith("Id") || field === "currency" || field === "expectedCurrency") {
            return <p className="assistant-run-value" key={field}><b>{name}</b> {action.labels[field] || value}</p>;
          }
          if (field === "paymentKind") {
            return <label key={field}>{name}<select value={current} onChange={(event) => change(event.target.value)}><option value="partial">{t("Installment", "Abono")}</option><option value="settlement">{t("Full payment", "Pago completo")}</option></select></label>;
          }
          return <label key={field}>{name}<input type={field.endsWith("Date") ? "date" : field === "amount" ? "number" : "text"} step={field === "amount" ? "0.01" : undefined} value={current} onChange={(event) => change(event.target.value)} /></label>;
        })}
        <button type="submit" className="assistant-confirm" disabled={busy}>{t("Approve and save", "Aprobar y guardar")}</button>
        {Object.keys(edits).length > 0 && <button type="button" className="assistant-open-draft" disabled={busy} onClick={() => onRespond("save", { fields: edits })}>{t("Save draft", "Guardar borrador")}</button>}
      </form>
    </>;
  }
  if (pending.kind === "input") return <>
    <p>{pending.question}</p>
    {pending.options.length ? <div className="assistant-run-options">{pending.options.map((option) => <button type="button" className="assistant-open-draft" key={option.id} disabled={busy} onClick={() => onRespond("answer", { answer: option.id })}>{option.label}{option.suggested && ` · ${t("Last used", "Último usado")}`}</button>)}</div>
      : <form onSubmit={(event) => { event.preventDefault(); onRespond("answer", { answer }); }}>
        <input aria-label={t("Answer the pending question", "Responder la pregunta pendiente")} value={answer} onChange={(event) => setAnswer(event.target.value)} maxLength={1000} />
        <button type="submit" className="assistant-confirm" disabled={busy || !answer.trim()}>{t("Continue", "Continuar")}</button>
      </form>}
  </>;
  return <>
    {pending.question && <p>{formatAssistantActionFeedback(pending.question, language)}</p>}
    <button type="button" className="assistant-confirm" disabled={busy} onClick={() => onRespond(pending.kind === "retry" ? "retry" : "continue")}>{pending.kind === "retry" ? t("Retry failed action", "Reintentar acción") : t("Resume work", "Retomar acciones")}</button>
  </>;
}
