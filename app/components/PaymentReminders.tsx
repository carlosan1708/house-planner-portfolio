"use client";

import { useCallback, useEffect, useState } from "react";
import { readJsonResponse } from "@/lib/api-client";
import type { PaymentReminder } from "@/lib/payment-reminders";
import { ExpenseDialog } from "./ExpensesWorkspace";
import "./payment-reminders.css";

type Language = "es" | "en";
type Draft = Omit<PaymentReminder, "amount"> & { amount: string };
const tr = (language: Language, es: string, en: string) => language === "es" ? es : en;
const blank = (currency: "CRC" | "USD"): Draft => ({ id: "", description: "", amount: "", currency, dueDate: "", vendor: "", notes: "", status: "pending", revision: 0 });
const demoReminders: PaymentReminder[] = [{ ...blank("USD"), id: "demo-reminder", description: "Revisar pago de materiales", amount: 250 }];

export default function PaymentReminders({ mode, language, canEdit, onCount, recordId }: {
  mode: "demo" | "real"; language: Language; canEdit: boolean; recordId?: string; onCount: (count: number) => void;
}) {
  const [reminders, setReminders] = useState<PaymentReminder[]>(mode === "demo" ? demoReminders : []);
  const [currency, setCurrency] = useState<"CRC" | "USD">(mode === "demo" ? "USD" : "CRC");
  const [loading, setLoading] = useState(mode === "real"), [error, setError] = useState("");
  const [busy, setBusy] = useState(false), [draft, setDraft] = useState<Draft | null>(null);
  const [filter, setFilter] = useState("pending"), [query, setQuery] = useState("");
  const load = useCallback(async (signal?: AbortSignal) => {
    if (mode === "demo") return;
    const data = await readJsonResponse<{ reminders: PaymentReminder[]; defaultCurrency: "CRC" | "USD" }>(await fetch("/api/expenses/reminders", { cache: "no-store", signal }));
    if (!Array.isArray(data.reminders)) throw new Error(tr(language, "No se pudieron cargar los recordatorios.", "Reminders could not be loaded."));
    if (signal?.aborted) return;
    setReminders(data.reminders); setCurrency(data.defaultCurrency); onCount(data.reminders.filter((item) => item.status === "pending").length);
  }, [language, mode, onCount]);
  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void load(controller.signal).catch((reason) => { if (!controller.signal.aborted) setError(reason.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [load]);

  useEffect(() => {
    if (mode !== "demo") return;
    const timer = window.setTimeout(() => onCount(reminders.filter((item) => item.status === "pending").length), 0);
    return () => window.clearTimeout(timer);
  }, [mode, reminders, onCount]);

  async function mutate(method: "POST" | "PATCH" | "DELETE", body: Record<string, unknown>, updateDemo: () => PaymentReminder[]) {
    setBusy(true); setError("");
    try {
      if (mode === "real") await readJsonResponse(await fetch("/api/expenses/reminders", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
      else { const next = updateDemo(); setReminders(next); onCount(next.filter((item) => item.status === "pending").length); }
      // A saved operation must not leave a form that can resubmit on refresh failure.
      setDraft(null);
      if (mode === "real") await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : tr(language, "No se pudo guardar.", "Could not save.")); }
    finally { setBusy(false); }
  }
  const edit = (item?: PaymentReminder) => { setError(""); setDraft(item ? { ...item, amount: item.amount === null ? "" : String(item.amount) } : blank(currency)); };
  const save = () => {
    if (!draft || !draft.description.trim()) { setError(tr(language, "La descripción es obligatoria.", "Description is required.")); return; }
    const amount = draft.amount === "" ? null : Number(draft.amount);
    if (amount !== null && (!Number.isFinite(amount) || amount < 0 || amount > 1e12)) { setError(tr(language, "El importe no es válido.", "Amount is invalid.")); return; }
    const item = { ...draft, description: draft.description.trim(), amount };
    void mutate(draft.id ? "PATCH" : "POST", item, () => draft.id ? reminders.map((old) => old.id === draft.id ? item : old) : [...reminders, { ...item, id: crypto.randomUUID() }]);
  };
  const toggle = (item: PaymentReminder) => {
    const status = item.status === "pending" ? "done" : "pending";
    void mutate("PATCH", { id: item.id, revision: item.revision, action: "status", status }, () => reminders.map((old) => old.id === item.id ? { ...old, status } : old));
  };
  const remove = (item: PaymentReminder) => {
    if (window.confirm(tr(language, `¿Eliminar el recordatorio “${item.description}”? No cambia el presupuesto ni los pagos.`, `Delete reminder “${item.description}”? This does not change the budget or payments.`)))
      void mutate("DELETE", { id: item.id, revision: item.revision }, () => reminders.filter((old) => old.id !== item.id));
  };
  const visible = reminders.filter((item) => recordId ? item.id === recordId : (filter === "all" || item.status === filter) && `${item.description} ${item.vendor} ${item.notes}`.toLocaleLowerCase(language).includes(query.toLocaleLowerCase(language)));
  const pending = reminders.filter((item) => item.status === "pending");
  const totals = pending.reduce<Partial<Record<"CRC" | "USD", number>>>((result, item) => {
    result[item.currency] = (result[item.currency] || 0) + Math.round((item.amount || 0) * 100);
    return result;
  }, {});
  if (!Object.keys(totals).length) totals[currency] = 0;
  const unpriced = pending.filter((item) => item.amount === null).length;
  const money = (item: Pick<PaymentReminder, "amount" | "currency">) => item.amount === null ? tr(language, "Sin importe", "No amount") : new Intl.NumberFormat(language === "es" ? "es-CR" : "en-US", { style: "currency", currency: item.currency, maximumFractionDigits: 2 }).format(item.amount);
  return <section className="payment-reminders" aria-label={tr(language, "Recordatorios de pago", "Payment reminders")}>
    <header className="reminder-heading"><div><h2>{tr(language, "Pagos pendientes", "Pending payments")}</h2><p>{tr(language, "Recordatorios de cosas por pagar. Son independientes del presupuesto y no registran pagos automáticamente.", "Reminders of things to pay. They are independent of the budget and do not automatically record payments.")}</p></div>{canEdit && <button className="expense-primary" disabled={busy || loading || Boolean(error && !reminders.length)} onClick={() => edit()}>{tr(language, "Nuevo recordatorio", "New reminder")}</button>}</header>
    {!loading && !(error && !reminders.length) && <section className="reminder-summary" aria-label={tr(language, "Total pendiente", "Pending total")}>
      <div><h3>{tr(language, "Total pendiente", "Pending total")}</h3><p>{tr(language, "Incluye todos los pendientes, sin aplicar filtros.", "Includes all pending reminders, regardless of filters.")}</p></div>
      <div className="reminder-summary-amounts">{(["CRC", "USD"] as const).filter((unit) => totals[unit] !== undefined).map((unit) => <div key={unit}><strong>{money({ amount: totals[unit]! / 100, currency: unit })}</strong><small>{unit}</small></div>)}</div>
      {unpriced > 0 && <p className="reminder-summary-unpriced">{unpriced} {unpriced === 1 ? tr(language, "pendiente sin importe, no incluido en el total.", "pending reminder without an amount, excluded from the total.") : tr(language, "pendientes sin importe, no incluidos en el total.", "pending reminders without an amount, excluded from the total.")}</p>}
    </section>}
    <div className="reminder-filters"><label>{tr(language, "Buscar recordatorios", "Search reminders")}<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} /></label><label>{tr(language, "Estado", "Status")}<select value={filter} onChange={(event) => setFilter(event.target.value)}><option value="pending">{tr(language, "Pendientes", "Pending")}</option><option value="done">{tr(language, "Resueltos", "Resolved")}</option><option value="all">{tr(language, "Todos", "All")}</option></select></label></div>
    {error && !draft && <div role="alert" className="warning-banner">{error}<button disabled={busy || loading} onClick={() => { setLoading(true); setError(""); void load().catch((reason) => setError(reason.message)).finally(() => setLoading(false)); }}>{tr(language, "Actualizar", "Refresh")}</button></div>}
    {loading ? <p role="status">{tr(language, "Cargando recordatorios…", "Loading reminders…")}</p> : error && !reminders.length ? null : !visible.length ? <p className="expense-empty">{tr(language, "No hay recordatorios con estos filtros.", "No reminders match these filters.")}</p> : <div className="reminder-grid">{visible.map((item) => <article className="reminder-card" key={item.id}>
      <div className="reminder-title"><h3>{mode === "demo" && item.id === "demo-reminder" && language === "en" ? "Review materials payment" : item.description}</h3><span>{item.status === "pending" ? tr(language, "Pendiente", "Pending") : tr(language, "Resuelto", "Resolved")}</span></div>
      <strong>{money(item)}</strong><small>{item.currency}</small>
      {item.dueDate && <p>{tr(language, "Fecha prevista", "Planned date")}: <time dateTime={item.dueDate}>{item.dueDate}</time></p>}
      {item.vendor && <p>{item.vendor}</p>}{item.notes && <p className="reminder-notes">{item.notes}</p>}
      {canEdit && <footer><button disabled={busy} onClick={() => toggle(item)}>{item.status === "pending" ? tr(language, "Marcar resuelto", "Mark resolved") : tr(language, "Reabrir", "Reopen")}</button><button disabled={busy} onClick={() => edit(item)}>{tr(language, "Editar", "Edit")}</button><button className="expense-delete" disabled={busy} onClick={() => remove(item)}>{tr(language, "Eliminar", "Delete")}</button></footer>}
    </article>)}</div>}
    {draft && <ExpenseDialog className="detail-backdrop expense-form-backdrop" label={tr(language, "Recordatorio de pago", "Payment reminder")} busy={busy} onClose={() => setDraft(null)}><section className="expense-form reminder-form"><h2>{draft.id ? tr(language, "Editar recordatorio", "Edit reminder") : tr(language, "Nuevo recordatorio", "New reminder")}</h2><div className="expense-form-fields"><fieldset disabled={busy}>
      <p>{tr(language, "Guardar o resolver este recordatorio no modifica el presupuesto ni lo pagado.", "Saving or resolving this reminder does not change the budget or paid total.")}</p>
      <label>{tr(language, "Descripción", "Description")} *<input value={draft.description} maxLength={300} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label>
      <div className="form-pair"><label>{tr(language, "Importe opcional", "Optional amount")}<input inputMode="decimal" type="number" min="0" max="1000000000000" step="0.01" value={draft.amount} onChange={(event) => setDraft({ ...draft, amount: event.target.value })} /></label><label>{tr(language, "Moneda", "Currency")}<select value={draft.currency} onChange={(event) => setDraft({ ...draft, currency: event.target.value as "CRC" | "USD" })}><option value="CRC">CRC</option><option value="USD">USD</option></select></label></div>
      <label>{tr(language, "Fecha prevista opcional", "Optional planned date")}<input type="date" value={draft.dueDate} onChange={(event) => setDraft({ ...draft, dueDate: event.target.value })} /></label>
      <label>{tr(language, "Proveedor opcional", "Optional vendor")}<input value={draft.vendor} maxLength={200} onChange={(event) => setDraft({ ...draft, vendor: event.target.value })} /></label>
      <label>{tr(language, "Notas", "Notes")}<textarea value={draft.notes} maxLength={4000} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} /></label>
      {error && <p role="alert" className="payment-form-error">{error}</p>}
    </fieldset></div><footer><button disabled={busy} onClick={() => setDraft(null)}>{tr(language, "Cancelar", "Cancel")}</button><button className="expense-primary" disabled={busy} onClick={save}>{busy ? tr(language, "Guardando…", "Saving…") : tr(language, "Guardar recordatorio", "Save reminder")}</button></footer></section></ExpenseDialog>}
  </section>;
}
