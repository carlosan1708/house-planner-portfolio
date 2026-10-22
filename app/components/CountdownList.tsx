"use client";

import { useState } from "react";
import { countdownTiming, type CountdownRecord } from "@/lib/countdowns";

type Props = {
  countdowns: CountdownRecord[];
  recipients: { uid: string; name: string; email: string }[];
  language: "es" | "en";
  now: number;
  busy: boolean;
  canEdit: boolean;
  canAcknowledge: boolean;
  onComplete: (id: string) => Promise<boolean>;
  onAcknowledge: (id: string) => Promise<boolean>;
  onUpdateRecipients: (id: string, uids: string[]) => Promise<boolean>;
  onDelete: (id: string) => Promise<boolean>;
};

export default function CountdownList({ countdowns, recipients, language, now, busy, canEdit, canAcknowledge, onComplete, onAcknowledge, onUpdateRecipients, onDelete }: Props) {
  const [editingRecipients, setEditingRecipients] = useState<{ id: string; uids: string[] } | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const text = (en: string, es: string) => language === "es" ? es : en;
  const date = (value: string) => new Date(value).toLocaleDateString(language === "es" ? "es-CR" : "en-US", { day: "numeric", month: "short", year: "numeric" });
  const active = countdowns.filter((item) => !item.completed);
  const completed = countdowns.filter((item) => item.completed).sort((a, b) => (b.completedAt || "").localeCompare(a.completedAt || ""));
  const complete = async (id: string) => {
    if (await onComplete(id)) { setEditingRecipients(null); setHistoryOpen(true); }
  };
  const renderCard = (item: CountdownRecord) => {
    const timing = countdownTiming(item, now);
    const names = item.recipientUids.map((uid) => recipients.find((recipient) => recipient.uid === uid)?.name).filter(Boolean).join(", ");
    return <article className={item.completed ? "completed" : `${timing.due ? "due" : ""} ${item.acknowledged ? "acknowledged" : ""}`} key={item.id} aria-label={item.title}>
      <div className="countdown-days"><b>{item.completed ? "✓" : timing.daysRemaining}</b><small>{item.completed ? text("done", "lista") : timing.daysRemaining === 1 ? text("day", "día") : text("days", "días")}</small></div>
      <div className="countdown-copy">
        <span className="overline">{item.completed ? text("COMPLETED", "COMPLETADA") : timing.due ? (item.acknowledged ? text("NOTICE SEEN", "AVISO VISTO") : text("DUE NOW", "VENCE AHORA")) : `${item.durationDays} ${text("DAY TIMER", "DÍAS")}`}</span>
        <h4>{item.title}</h4>
        {!item.completed && <div className="countdown-track"><i style={{ width: `${timing.progress}%` }} /></div>}
        {item.completedAt && item.completed && <small>{text("Completed on", "Completada el")} {date(item.completedAt)}</small>}
        <small>{item.completed ? text("Original deadline", "Plazo original") : text("Due", "Vence")} {date(item.dueAt)}</small>
        {item.completed ? <small>{text("Reminders stopped", "Recordatorios detenidos")}</small> : <small className="countdown-recipient-summary">✉ {names || text("No eligible recipients", "Sin destinatarios elegibles")}</small>}
      </div>
      {!item.completed && <div className="countdown-actions">
        {canEdit && <button className="countdown-complete" disabled={busy} aria-label={text(`Complete ${item.title}`, `Completar ${item.title}`)} onClick={() => void complete(item.id)}>✓ {text("Complete", "Completar")}</button>}
        {canAcknowledge && timing.due && !item.acknowledged && <button disabled={busy} title={text("Only silences your notification; the task stays active", "Solo silencia tu aviso; la tarea sigue activa")} onClick={() => void onAcknowledge(item.id)}>{text("Notice seen", "Aviso visto")}</button>}
        {canEdit && <button disabled={busy} aria-label={text(`Edit recipients for ${item.title}`, `Editar destinatarios de ${item.title}`)} onClick={() => setEditingRecipients({ id: item.id, uids: [...item.recipientUids] })}>✉</button>}
        {canEdit && <button aria-label={text(`Delete countdown ${item.title}`, `Eliminar cuenta regresiva ${item.title}`)} className="text-danger" disabled={busy} onClick={() => void onDelete(item.id)}>×</button>}
      </div>}
      {!item.completed && editingRecipients?.id === item.id && <div className="countdown-recipient-editor">
        <b>{text("Who receives this reminder?", "¿Quién recibe este recordatorio?")}</b>
        <div>{recipients.map((recipient) => <label key={recipient.uid}><input type="checkbox" checked={editingRecipients.uids.includes(recipient.uid)} onChange={() => setEditingRecipients({ id: item.id, uids: editingRecipients.uids.includes(recipient.uid) ? editingRecipients.uids.filter((uid) => uid !== recipient.uid) : [...editingRecipients.uids, recipient.uid] })} /> {recipient.name} <small>{recipient.email}</small></label>)}</div>
        <span><button className="secondary-button" onClick={() => setEditingRecipients(null)}>{text("Cancel", "Cancelar")}</button><button className="primary-button" disabled={busy || !editingRecipients.uids.length} onClick={() => void onUpdateRecipients(item.id, editingRecipients.uids).then((saved) => { if (saved) setEditingRecipients(null); })}>{text("Save recipients", "Guardar destinatarios")}</button></span>
      </div>}
    </article>;
  };
  return <>
    {active.length ? <div className="countdown-grid countdown-active">{active.map(renderCard)}</div> : <p className="countdown-empty">{completed.length ? text("No pending countdowns.", "No hay cuentas regresivas pendientes.") : text("No countdowns yet. The first one will default to 10 days.", "Aún no hay contadores. El primero tendrá 10 días por defecto.")}</p>}
    {completed.length > 0 && <details className="countdown-history" open={historyOpen} onToggle={(event) => setHistoryOpen(event.currentTarget.open)}>
      <summary>{text("Completed", "Completadas")} ({completed.length})</summary>
      <div className="countdown-grid">{completed.map(renderCard)}</div>
    </details>}
  </>;
}
