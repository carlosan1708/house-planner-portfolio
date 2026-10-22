"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ActivityCategory, ActivityChange, ActivityEvent, ActivityPage } from "@/lib/activity-types";
import { ACTIVITY_CATEGORIES } from "@/lib/activity-types";
import type { WorkspaceTab } from "@/lib/project";

type Language = "es" | "en";
const tr = (language: Language, en: string, es: string) => language === "es" ? es : en;

const DEMO_EVENT_TIME = Date.now();
function demoEvents(language: Language): ActivityEvent[] {
  return [
    { id: "demo-1", sequence: 3, category: "expense", action: "expense.receipt_linked", source: "user", actor: { uid: "demo-carlos", name: "Carlos", role: "admin" }, target: { type: "expense", id: "demo-expense", label: tr(language, "Kitchen cabinetry", "Mobiliario de cocina"), section: "expenses", exists: true }, summaryParams: { fileName: tr(language, "Kitchen_invoice.pdf", "Factura_cocina.pdf"), amount: 500 }, changes: [{ field: "receipt", before: null, after: tr(language, "Kitchen_invoice.pdf", "Factura_cocina.pdf"), format: "text" }], changeCount: 1, occurredAt: new Date(DEMO_EVENT_TIME - 20 * 60_000).toISOString(), visibility: { requiredTabs: ["expenses"] }, integrity: "verified", hasDetails: false },
    { id: "demo-2", sequence: 2, category: "budget", action: "budget.published", source: "user", actor: { uid: "demo-ana", name: "Ana", role: "editor" }, target: { type: "workbook", id: "demo-budget", label: "Plan 4", section: "budget", exists: true }, summaryParams: { changeCount: 2, planVersion: 4 }, changes: [{ field: tr(language, "Budget · Cabinetry · Paid price", "Presupuesto · Mobiliario · Precio pagado"), before: 400, after: 500, format: "currency_usd" }], changeCount: 2, occurredAt: new Date(DEMO_EVENT_TIME - 4 * 60 * 60_000).toISOString(), visibility: { requiredTabs: ["budget"] }, integrity: "verified", hasDetails: false },
    { id: "demo-3", sequence: 1, category: "document", action: "document.deleted", source: "user", actor: { uid: "demo-ana", name: "Ana", role: "editor" }, target: { type: "document", id: "demo-doc", label: tr(language, "Preliminary_plan.pdf", "Plano preliminar.pdf"), section: "documents", exists: false }, summaryParams: {}, changes: [{ field: "deleted", before: false, after: true, format: "status" }], changeCount: 1, occurredAt: new Date(DEMO_EVENT_TIME - 26 * 60 * 60_000).toISOString(), visibility: { requiredTabs: ["documents"] }, integrity: "verified", hasDetails: false },
  ];
}

const categoryLabel = (category: ActivityCategory, language: Language) => ({
  project: tr(language, "Project", "Proyecto"), budget: tr(language, "Budget", "Presupuesto"), expense: tr(language, "Expenses", "Gastos"), document: tr(language, "Documents", "Documentos"), aesthetic: tr(language, "Aesthetics", "Estética"), access: tr(language, "Access", "Acceso"), plan: tr(language, "Plan", "Plan"), decision: tr(language, "Decisions", "Decisiones"), site: tr(language, "Site progress", "Progreso de obra"),
})[category];

function activitySentence(event: ActivityEvent, language: Language) {
  const actor = event.actor.name || tr(language, "A project member", "Un miembro del proyecto");
  const label = event.target.label;
  const count = Number(event.summaryParams.changeCount || event.changeCount || 0);
  const fileName = String(event.summaryParams.fileName || "");
  const sentences: Record<string, [string, string]> = {
    "project.created": [`${actor} created project “${label}”`, `${actor} creó el proyecto “${label}”`],
    "project.currency_updated": [`${actor} corrected the currency for “${label}” without converting amounts`, `${actor} corrigió la moneda de “${label}” sin convertir importes`],
    "distribution.requested": [`${actor} requested a prepared 3D house model`, `${actor} solicitó un modelo 3D preparado de la casa`],
    "distribution.preparation_updated": [`${actor} updated 3D model preparation`, `${actor} actualizó la preparación del modelo 3D`],
    "distribution.imported": [`${actor} imported the prepared model for “${label}”`, `${actor} importó el modelo preparado de “${label}”`],
    "distribution.corrected": [`${actor} corrected “${label}” in the 3D model`, `${actor} corrigió “${label}” en el modelo 3D`],
    "qa.reset": [`${actor} reset the QA workspace`, `${actor} reinició el espacio de QA`],
    "budget.replaced": [`${actor} replaced the official workbook with “${label}”`, `${actor} reemplazó el presupuesto oficial por “${label}”`],
    "budget.published": [`${actor} published ${count} budget change${count === 1 ? "" : "s"}`, `${actor} publicó ${count} cambio${count === 1 ? "" : "s"} en el presupuesto`],
    "budget.restored": [`${actor} restored “${label}”`, `${actor} restauró “${label}”`],
    "budget.submitted": [`${actor} submitted ${count} budget change${count === 1 ? "" : "s"} for approval`, `${actor} envió ${count} cambio${count === 1 ? "" : "s"} del presupuesto para aprobación`],
    "budget.approved": [`${actor} approved “${label}”`, `${actor} aprobó “${label}”`],
    "budget.rejected": [`${actor} rejected “${label}”`, `${actor} rechazó “${label}”`],
    "expense.receipt_linked": [`${actor} linked “${fileName}” to “${label}”`, `${actor} vinculó “${fileName}” con “${label}”`],
    "expense.receipt_unlinked": [`${actor} unlinked “${fileName}” from “${label}”`, `${actor} desvinculó “${fileName}” de “${label}”`],
    "expense.mobile_capture_added": [`${actor} added a mobile field capture to “${label}”`, `${actor} agregó una captura móvil a “${label}”`],
    "expense.invoice_uploaded": [`${actor} added invoice “${label}”`, `${actor} agregó la factura “${label}”`],
    "expense.invoice_deleted": [`${actor} deleted invoice “${label}”`, `${actor} eliminó la factura “${label}”`],
    "expense.purchase_created": [`${actor} created purchase “${label}”`, `${actor} creó la compra “${label}”`],
    "expense.purchase_updated": [`${actor} updated purchase “${label}”`, `${actor} actualizó la compra “${label}”`],
    "expense.purchase_deleted": [`${actor} deleted purchase “${label}”`, `${actor} eliminó la compra “${label}”`],
    "expense.purchase_photo_added": [`${actor} added a product photo to “${label}”`, `${actor} agregó una foto de producto a “${label}”`],
    "expense.purchase_photo_deleted": [`${actor} removed a product photo from “${label}”`, `${actor} quitó una foto de producto de “${label}”`],
    "expense.document_created": [`${actor} created document “${label}”`, `${actor} creó el comprobante “${label}”`],
    "expense.document_updated": [`${actor} updated document “${label}”`, `${actor} actualizó el comprobante “${label}”`],
    "expense.document_deleted": [`${actor} deleted document “${label}”`, `${actor} eliminó el comprobante “${label}”`],
    "expense.document_files_added": [`${actor} added files to “${label}”`, `${actor} agregó archivos a “${label}”`],
    "expense.document_file_deleted": [`${actor} removed a file from “${label}”`, `${actor} quitó un archivo de “${label}”`],
    "document.uploaded": [`${actor} uploaded “${label}”`, `${actor} subió “${label}”`],
    "document.moved": [`${actor} moved “${label}”`, `${actor} movió “${label}”`],
    "document.description_updated": [`${actor} updated the description of “${label}”`, `${actor} actualizó la descripción de “${label}”`],
    "document.quote_reference_updated": [`${actor} changed whether “${label}” appears in quote reviews`, `${actor} cambió si “${label}” aparece en cotizaciones`],
    "document.deleted": [`${actor} deleted “${label}”`, `${actor} eliminó “${label}”`],
    "folder.created": [`${actor} created folder “${label}”`, `${actor} creó la carpeta “${label}”`],
    "folder.renamed": [`${actor} renamed folder “${label}”`, `${actor} renombró la carpeta “${label}”`],
    "folder.moved": [`${actor} moved folder “${label}”`, `${actor} movió la carpeta “${label}”`],
    "folder.deleted": [`${actor} deleted folder “${label}”`, `${actor} eliminó la carpeta “${label}”`],
    "aesthetic.folder_created": [`${actor} created aesthetic folder “${label}”`, `${actor} creó la carpeta estética “${label}”`],
    "aesthetic.folder_renamed": [`${actor} renamed aesthetic folder “${label}”`, `${actor} renombró la carpeta estética “${label}”`],
    "aesthetic.folder_deleted": [`${actor} deleted aesthetic folder “${label}”`, `${actor} eliminó la carpeta estética “${label}”`],
    "aesthetic.image_uploaded": [`${actor} added “${label}” to Aesthetics`, `${actor} agregó “${label}” a Estética`],
    "aesthetic.image_deleted": [`${actor} deleted “${label}” from Aesthetics`, `${actor} eliminó “${label}” de Estética`],
    "aesthetic.image_moved": [`${actor} moved “${label}” to another aesthetic folder`, `${actor} movió “${label}” a otra carpeta estética`],
    "aesthetic.carousel_updated": [`${actor} curated the carousel for “${label}”`, `${actor} seleccionó el carrusel de “${label}”`],
    "aesthetic.caption_updated": [`${actor} updated the caption for “${label}”`, `${actor} actualizó la descripción de “${label}”`],
    "aesthetic.notes_updated": [`${actor} updated the notes for “${label}”`, `${actor} actualizó las notas de “${label}”`],
    "aesthetic.classification_updated": [`${actor} classified “${label}”`, `${actor} clasificó “${label}”`],
    "access.invited": [`${actor} invited “${label}”`, `${actor} invitó a “${label}”`],
    "access.invitation_revoked": [`${actor} revoked the invitation for “${label}”`, `${actor} revocó la invitación de “${label}”`],
    "access.link_created": [`${actor} created the read link “${label}”`, `${actor} creó el enlace de lectura “${label}”`],
    "access.link_updated": [`${actor} updated permissions for the read link “${label}”`, `${actor} actualizó los permisos del enlace de lectura “${label}”`],
    "access.link_revoked": [`${actor} revoked the read link “${label}”`, `${actor} revocó el enlace de lectura “${label}”`],
    "access.link_redeemed": [`${actor} joined using the read link “${label}”`, `${actor} entró mediante el enlace de lectura “${label}”`],
    "access.invitation_accepted": [`${actor} accepted access to the project`, `${actor} aceptó el acceso al proyecto`],
    "access.member_access_changed": [`${actor} changed access for “${label}”`, `${actor} cambió el acceso de “${label}”`],
    "access.member_removed": [`${actor} removed a user from the project`, `${actor} eliminó un usuario del proyecto`],
    "access.permissions_changed": [`${actor} changed section permissions for “${label}”`, `${actor} cambió los permisos de secciones de “${label}”`],
    "access.folders_changed": [`${actor} changed folder access for “${label}”`, `${actor} cambió el acceso a carpetas de “${label}”`],
    "plan.created": [`${actor} added “${label}” to the plan`, `${actor} agregó “${label}” al plan`],
    "plan.updated": [`${actor} updated “${label}” in the plan`, `${actor} actualizó “${label}” en el plan`],
    "plan.deleted": [`${actor} deleted “${label}” from the plan`, `${actor} eliminó “${label}” del plan`],
    "plan.template_applied": [`${actor} added ${Number(event.summaryParams.count || 0)} plan items`, `${actor} agregó ${Number(event.summaryParams.count || 0)} partidas al plan`],
    "countdown.created": [`${actor} created countdown “${label}”`, `${actor} creó la cuenta regresiva “${label}”`],
    "countdown.recipients_updated": [`${actor} changed recipients for “${label}”`, `${actor} cambió los destinatarios de “${label}”`],
    "countdown.acknowledged": [`${actor} acknowledged “${label}”`, `${actor} confirmó “${label}”`],
    "countdown.completed": [`${actor} completed “${label}”`, `${actor} completó “${label}”`],
    "countdown.deleted": [`${actor} deleted countdown “${label}”`, `${actor} eliminó la cuenta regresiva “${label}”`],
    "decision.created": [`${actor} created decision “${label}”`, `${actor} creó la decisión “${label}”`],
    "decision.updated": [`${actor} updated decision “${label}”`, `${actor} actualizó la decisión “${label}”`],
    "decision.deleted": [`${actor} deleted decision “${label}”`, `${actor} eliminó la decisión “${label}”`],
    "decision.mobile_capture_added": [`${actor} added a mobile field capture to decision “${label}”`, `${actor} agregó una captura móvil a la decisión “${label}”`],
    "site_issue.created": [`${actor} created progress entry “${label}”`, `${actor} creó el registro de avance “${label}”`],
    "site_issue.updated": [`${actor} updated progress entry “${label}”`, `${actor} actualizó el registro de avance “${label}”`],
    "site_issue.deleted": [`${actor} deleted progress entry “${label}”`, `${actor} eliminó el registro de avance “${label}”`],
    "site_issue.mobile_capture_added": [`${actor} added a mobile field capture to “${label}”`, `${actor} agregó una captura móvil al avance “${label}”`],
  };
  return (sentences[event.action] || [`${actor} updated “${label}”`, `${actor} actualizó “${label}”`])[language === "es" ? 1 : 0];
}

function valueText(value: unknown, format: ActivityChange["format"], language: Language) {
  if (value === null || value === undefined || value === "") return tr(language, "Empty", "Vacío");
  if ((format === "currency_crc" || format === "currency_usd") && typeof value === "number") return new Intl.NumberFormat(language === "es" ? "es-CR" : "en-US", { style: "currency", currency: format === "currency_usd" ? "USD" : "CRC", maximumFractionDigits: Number.isInteger(value) ? 0 : 2 }).format(value);
  if (format === "date" && typeof value === "string") { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(language === "es" ? "es-CR" : "en-US", { dateStyle: "medium" }).format(date); }
  if (Array.isArray(value)) return value.join(", ") || tr(language, "Empty", "Vacío");
  if (typeof value === "object") return Object.entries(value as Record<string, unknown>).map(([key, item]) => `${key}: ${String(item)}`).join(", ");
  if (typeof value === "boolean") return value ? tr(language, "Yes", "Sí") : tr(language, "No", "No");
  return String(value);
}

function initials(name: string) { return name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "HP"; }

function normalizeDetails(value: unknown): ActivityChange[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 500).map((item) => {
    const row = (item || {}) as Record<string, unknown>;
    if (typeof row.field === "string") return row as ActivityChange;
    const before = row.before && typeof row.before === "object" ? (row.before as Record<string, unknown>).v ?? (row.before as Record<string, unknown>).value : row.before;
    const after = row.after && typeof row.after === "object" ? (row.after as Record<string, unknown>).v ?? (row.after as Record<string, unknown>).value : row.after;
    return { field: `${String(row.sheet || "Workbook")} · R${String(row.row || "")}C${String(row.column || "")}`, before, after, format: typeof (after ?? before) === "number" ? "number" : "text" };
  });
}

function ActivityCard({ event, language, onNavigate }: { event: ActivityEvent; language: Language; onNavigate?: (section: WorkspaceTab, id: string) => void }) {
  const [loadedDetails, setLoadedDetails] = useState<ActivityChange[] | null>(null);
  const details = loadedDetails || event.changes;
  const [loading, setLoading] = useState(false);
  const loadDetails = async () => {
    if (!event.hasDetails || details.length >= event.changeCount || loading) return;
    setLoading(true);
    try {
      const response = await fetch(`/api/activity/${encodeURIComponent(event.id)}`, { cache: "no-store" });
      if (response.ok) { const data = await response.json() as { details?: unknown }; const full = normalizeDetails(data.details); if (full.length) setLoadedDetails(full); }
    } finally { setLoading(false); }
  };
  return <article className={`activity-entry category-${event.category}`}>
    <span className="activity-avatar">{initials(event.actor.name)}</span>
    <div className="activity-entry-body">
      <div className="activity-entry-head"><span className="activity-category">{categoryLabel(event.category, language)}</span><time>{new Intl.DateTimeFormat(language === "es" ? "es-CR" : "en-US", { timeStyle: "short" }).format(new Date(event.occurredAt))}</time></div>
      <h3>{activitySentence(event, language)}</h3>
      <small>{event.source === "assistant" ? tr(language, "Assisted by AI", "Asistido por IA") : event.actor.role === "admin" ? tr(language, "Administrator", "Administrador") : event.actor.role === "viewer" ? tr(language, "Viewer", "Lector") : tr(language, "Editor", "Editor")}</small>
      {event.integrity === "invalid" && <div className="activity-integrity-warning">{tr(language, "This record did not pass its integrity check.", "Este registro no superó la verificación de integridad.")}</div>}
      {details.length > 0 && <details className="activity-details" onToggle={(toggle) => { if ((toggle.currentTarget as HTMLDetailsElement).open) void loadDetails(); }}>
        <summary>{tr(language, `View ${event.changeCount} change${event.changeCount === 1 ? "" : "s"}`, `Ver ${event.changeCount} cambio${event.changeCount === 1 ? "" : "s"}`)}</summary>
        <div className="activity-change-list">{details.map((change, index) => <div className="activity-change" key={`${change.field}-${index}`}><b>{change.field === "notes" ? tr(language, "Notes", "Notas") : change.field === "receipt" ? tr(language, "Receipt", "Comprobante") : change.field === "deleted" ? tr(language, "Deleted", "Eliminado") : change.field}</b><span><del>{valueText(change.before, change.format, language)}</del><i>→</i><ins>{valueText(change.after, change.format, language)}</ins></span></div>)}</div>
        {loading && <p>{tr(language, "Loading complete detail…", "Cargando el detalle completo…")}</p>}
      </details>}
      {event.target.exists && onNavigate && <button className="activity-open-target" onClick={() => onNavigate(event.target.section, event.target.id)}>{tr(language, "Open section", "Abrir sección")} →</button>}
    </div>
  </article>;
}

export default function ActivityWorkspace({ mode, language, onNavigate }: { mode: "demo" | "real"; language: Language; onNavigate: (section: WorkspaceTab, id: string) => void }) {
  const [events, setEvents] = useState<ActivityEvent[]>(mode === "demo" ? demoEvents(language) : []);
  const [cursor, setCursor] = useState<string | null>(null);
  const [category, setCategory] = useState("");
  const [actor, setActor] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [loading, setLoading] = useState(mode === "real");
  const [error, setError] = useState("");
  const actors = useMemo(() => [...new Map(events.map((event) => [event.actor.uid, event.actor])).values()].sort((a, b) => a.name.localeCompare(b.name)), [events]);
  const load = useCallback(async (append = false, next = "") => {
    if (mode === "demo") return;
    setLoading(true); setError("");
    const params = new URLSearchParams({ limit: "25" });
    if (category) params.set("category", category); if (actor) params.set("actor", actor); if (from) params.set("from", from); if (to) params.set("to", to); if (next) params.set("cursor", next);
    try {
      const response = await fetch(`/api/activity?${params}`, { cache: "no-store" });
      if (!response.ok) throw new Error("activity");
      const data = await response.json() as ActivityPage;
      setEvents((current) => append ? [...current, ...data.events] : data.events); setCursor(data.nextCursor);
    } catch { setError(tr(language, "Activity could not be loaded.", "No se pudo cargar la actividad.")); }
    finally { setLoading(false); }
  }, [actor, category, from, language, mode, to]);
  useEffect(() => { if (mode !== "real") return; const timer = window.setTimeout(() => void load(false), 0); return () => window.clearTimeout(timer); }, [mode, load]);
  const visibleEvents = mode === "demo" ? demoEvents(language) : events;
  const grouped = visibleEvents.reduce<Record<string, ActivityEvent[]>>((groups, event) => { const date = new Date(event.occurredAt); const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; (groups[key] ||= []).push(event); return groups; }, {});
  return <section className="activity-workspace">
    <div className="page-intro"><div><span className="overline">{tr(language, "TRACEABILITY", "TRAZABILIDAD")}</span><h2>{tr(language, "Project activity", "Actividad del proyecto")}</h2><p>{tr(language, "A protected record of completed changes you are allowed to see.", "Un registro protegido de los cambios completados que tienes permiso para ver.")}</p></div><span className="activity-protected">✓ {tr(language, "Protected record", "Registro protegido")}</span></div>
    <div className="activity-filters">
      <label><span>{tr(language, "Category", "Categoría")}</span><select value={category} onChange={(event) => setCategory(event.target.value)}><option value="">{tr(language, "All", "Todas")}</option>{ACTIVITY_CATEGORIES.map((item) => <option key={item} value={item}>{categoryLabel(item, language)}</option>)}</select></label>
      <label><span>{tr(language, "Member", "Miembro")}</span><select value={actor} onChange={(event) => setActor(event.target.value)}><option value="">{tr(language, "Everyone", "Todos")}</option>{actors.map((item) => <option key={item.uid} value={item.uid}>{item.name}</option>)}</select></label>
      <label><span>{tr(language, "From", "Desde")}</span><input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
      <label><span>{tr(language, "To", "Hasta")}</span><input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
    </div>
    {error && <div className="form-error">{error}</div>}
    {!loading && !visibleEvents.length && <div className="activity-empty"><b>{tr(language, "No activity yet", "Aún no hay actividad")}</b><p>{tr(language, "New completed project changes will appear here.", "Los nuevos cambios completados del proyecto aparecerán aquí.")}</p></div>}
    <div className="activity-timeline">{Object.entries(grouped).map(([day, items]) => <section key={day}><h2>{new Intl.DateTimeFormat(language === "es" ? "es-CR" : "en-US", { dateStyle: "full" }).format(new Date(`${day}T12:00:00`))}</h2>{items.map((event) => <ActivityCard key={event.id} event={event} language={language} onNavigate={onNavigate} />)}</section>)}</div>
    {loading && <div className="editor-loading">{tr(language, "Loading activity…", "Cargando actividad…")}</div>}
    {cursor && !loading && <button className="secondary-button activity-load-more" onClick={() => void load(true, cursor)}>{tr(language, "Load more", "Cargar más")}</button>}
  </section>;
}

export function ActivitySummaryCard({ mode, language, onNavigate }: { mode: "demo" | "real"; language: Language; onNavigate: () => void }) {
  const [events, setEvents] = useState<ActivityEvent[]>(mode === "demo" ? demoEvents(language).slice(0, 5) : []);
  useEffect(() => { if (mode !== "real") return; const timer = window.setTimeout(() => { void fetch("/api/activity?limit=5", { cache: "no-store" }).then((response) => response.ok ? response.json() : null).then((data: ActivityPage | null) => { if (data) setEvents(data.events); }).catch(() => undefined); }, 0); return () => window.clearTimeout(timer); }, [mode]);
  const visibleEvents = mode === "demo" ? demoEvents(language).slice(0, 5) : events;
  return <section className="card activity-summary-card"><div className="section-head"><div><span className="overline">{tr(language, "RECENT CHANGES", "CAMBIOS RECIENTES")}</span><h3>{tr(language, "Project activity", "Actividad del proyecto")}</h3></div><button onClick={onNavigate}>{tr(language, "View all", "Ver todo")} →</button></div>{visibleEvents.length ? <div>{visibleEvents.map((event) => <div className="activity-summary-row" key={event.id}><span className={`activity-summary-dot category-${event.category}`} /><span><b>{activitySentence(event, language)}</b><small>{new Intl.DateTimeFormat(language === "es" ? "es-CR" : "en-US", { dateStyle: "short", timeStyle: "short" }).format(new Date(event.occurredAt))}</small></span></div>)}</div> : <p>{tr(language, "New completed changes will appear here.", "Los nuevos cambios completados aparecerán aquí.")}</p>}</section>;
}
