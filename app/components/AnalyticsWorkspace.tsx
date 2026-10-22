"use client";

import { useEffect, useId, useState } from "react";
import type { UsageAnalyticsResponse, UsageContext, UsageTotals } from "@/lib/usage-types";
import "./analytics.css";

type Language = "es" | "en";
type Preset = "1" | "7" | "30" | "90" | "custom";
type ProjectOption = { projectId: string; name: string };
const TIMEZONE = "America/Costa_Rica";
const DAY_MS = 86_400_000;
const tr = (language: Language, en: string, es: string) => language === "es" ? es : en;

function todayInCostaRica() {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const part = (type: string) => parts.find((item) => item.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function shiftDay(day: string, offset: number) {
  return new Date(Date.parse(`${day}T00:00:00Z`) + offset * DAY_MS).toISOString().slice(0, 10);
}

function presetRange(days: number) {
  const to = todayInCostaRica();
  return { from: shiftDay(to, 1 - days), to };
}

function validDay(day: string) {
  const timestamp = Date.parse(`${day}T00:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === day;
}

function rangeError(from: string, to: string, today: string, language: Language) {
  if (!validDay(from) || !validDay(to)) return tr(language, "Choose both dates.", "Selecciona ambas fechas.");
  if (from > to) return tr(language, "The start date must be before or equal to the end date.", "La fecha inicial debe ser anterior o igual a la fecha final.");
  if (to > today) return tr(language, "Choose dates through today in Costa Rica.", "Selecciona fechas hasta hoy en Costa Rica.");
  if ((Date.parse(to) - Date.parse(from)) / DAY_MS >= 90) return tr(language, "Choose a range of at most 90 days.", "Selecciona un rango de máximo 90 días.");
  const earliest = shiftDay(today, -89);
  if (from < earliest) return tr(language, `Only the last 90 days are available. Choose dates from ${dayText(earliest, language)}.`, `Solo están disponibles los últimos 90 días. Selecciona fechas desde el ${dayText(earliest, language)}.`);
  return "";
}

function numberText(value: number, language: Language) {
  return new Intl.NumberFormat(language === "es" ? "es-CR" : "en-US").format(value);
}

function durationText(milliseconds: number, language: Language) {
  const minutes = Math.floor(Math.max(0, milliseconds) / 60_000);
  if (milliseconds > 0 && minutes === 0) return "< 1 min";
  if (minutes < 60) return `${numberText(minutes, language)} min`;
  return `${numberText(Math.floor(minutes / 60), language)} h ${minutes % 60} min`;
}

function dayText(day: string, language: Language, short = false) {
  return new Intl.DateTimeFormat(language === "es" ? "es-CR" : "en-US", {
    timeZone: TIMEZONE, ...(short ? { day: "numeric", month: "short" } as const : { dateStyle: "medium" } as const),
  }).format(new Date(`${day}T12:00:00-06:00`));
}

function timestampText(value: string, language: Language) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat(language === "es" ? "es-CR" : "en-US", { timeZone: TIMEZONE, dateStyle: "medium", timeStyle: "short" }).format(date);
}

function sectionText(section: string, language: Language) {
  const labels: Record<string, [string, string]> = {
    access: ["Access", "Acceso"], overview: ["Overview", "Resumen"], activity: ["Activity", "Actividad"], budget: ["Budget", "Presupuesto"],
    quotes: ["Quotes", "Cotizaciones"], expenses: ["Expenses", "Gastos"], documents: ["Documents", "Documentos"], notes: ["Notes", "Notas"],
    aesthetics: ["Aesthetics", "Estética"], distribution: ["3D distribution", "Distribución 3D"], approvals: ["Approvals", "Aprobaciones"],
    plan: ["Plan and schedule", "Plan y cronograma"], decisions: ["Decisions", "Decisiones"], site: ["Site progress", "Progreso de obra"], analytics: ["App usage", "Uso de la app"],
  };
  return labels[section]?.[language === "es" ? 1 : 0] || section;
}

function DailyChart({ daily, language }: { daily: UsageAnalyticsResponse["daily"]; language: Language }) {
  const descriptionId = useId();
  const series = [
    { key: "visits", label: tr(language, "Visits", "Visitas"), color: "#5364db", dash: undefined },
    { key: "views", label: tr(language, "Views", "Vistas"), color: "#9365b5", dash: "7 4" },
    { key: "actions", label: tr(language, "Actions", "Acciones"), color: "#a06b22", dash: "2 4" },
  ] as const;
  const max = Math.max(1, ...daily.flatMap((day) => series.map((item) => day[item.key])));
  const ceiling = max <= 4 ? 4 : Math.ceil(max / 4) * 4;
  const x = (index: number) => daily.length === 1 ? 400 : 48 + index / (daily.length - 1) * 684;
  const y = (value: number) => 194 - value / ceiling * 168;
  const ticks = [...new Set([0, 1, 2, 3, 4].map((tick) => Math.round((daily.length - 1) * tick / 4)))];
  return <article className="card analytics-daily">
    <div className="section-head"><div><span className="overline">{tr(language, "DAILY TREND", "EVOLUCIÓN DIARIA")}</span><h3>{tr(language, "Visits and interactions", "Visitas e interacciones")}</h3></div></div>
    <p className="analytics-caption" id={descriptionId}>{tr(language, "Daily visits, section views and completed actions. Dates use Costa Rica time.", "Visitas, vistas de secciones y acciones completadas por día. Las fechas usan la hora de Costa Rica.")}</p>
    <ul className="analytics-legend">{series.map((item) => <li key={item.key}><i className={`analytics-line-key ${item.key}`} />{item.label}</li>)}</ul>
    <svg className="analytics-chart" viewBox="0 0 760 234" role="img" aria-label={tr(language, "Daily visits, views and actions chart", "Gráfico diario de visitas, vistas y acciones")} aria-describedby={descriptionId}>
      {[0, 1, 2, 3, 4].map((tick) => <g key={tick}><line x1="48" x2="732" y1={y(ceiling * tick / 4)} y2={y(ceiling * tick / 4)} className="analytics-grid-line" /><text x="39" y={y(ceiling * tick / 4) + 4} textAnchor="end">{numberText(ceiling * tick / 4, language)}</text></g>)}
      {series.map((item) => <g key={item.key}><polyline points={daily.map((day, index) => `${x(index)},${y(day[item.key])}`).join(" ")} fill="none" stroke={item.color} strokeWidth="2.5" strokeDasharray={item.dash} strokeLinejoin="round" />{daily.map((day, index) => <circle key={day.day} cx={x(index)} cy={y(day[item.key])} r="2.7" fill={item.color}><title>{`${dayText(day.day, language)} · ${item.label}: ${numberText(day[item.key], language)}`}</title></circle>)}</g>)}
      {ticks.map((index) => daily[index] && <text key={index} x={x(index)} y="222" textAnchor={index === 0 ? "start" : index === daily.length - 1 ? "end" : "middle"}>{dayText(daily[index].day, language, true)}</text>)}
    </svg>
    <details className="analytics-chart-data"><summary>{tr(language, "View daily data", "Ver datos diarios")}</summary><div className="analytics-table-scroll" role="region" aria-label={tr(language, "Daily data", "Datos diarios")} tabIndex={0}><table><caption className="analytics-sr-only">{tr(language, "Daily usage values", "Valores diarios de uso")}</caption><thead><tr><th scope="col">{tr(language, "Date", "Fecha")}</th>{series.map((item) => <th scope="col" key={item.key}>{item.label}</th>)}</tr></thead><tbody>{daily.map((day) => <tr key={day.day}><th scope="row">{dayText(day.day, language)}</th>{series.map((item) => <td key={item.key}>{numberText(day[item.key], language)}</td>)}</tr>)}</tbody></table></div></details>
  </article>;
}

function Breakdown({ title, overline, rows, language, showVisits = true }: { title: string; overline: string; rows: Array<{ id: string; name: string; totals: UsageTotals }>; language: Language; showVisits?: boolean }) {
  const maximum = Math.max(1, ...rows.map((row) => row.totals.views));
  return <article className="card analytics-breakdown"><div className="section-head"><div><span className="overline">{overline}</span><h3>{title}</h3></div></div>
    {!rows.length && <p className="analytics-caption">{tr(language, "No usage in this range.", "Sin uso en este rango.")}</p>}
    <ul>{rows.map((row) => <li key={row.id}><div><b>{row.name}</b><span>{numberText(row.totals.views, language)} {tr(language, "views", "vistas")}</span></div><div className="analytics-bar" aria-hidden="true"><i style={{ width: `${row.totals.views / maximum * 100}%` }} /></div><small>{showVisits && <>{numberText(row.totals.visits, language)} {tr(language, "visits", "visitas")} · </>}{numberText(row.totals.actions, language)} {tr(language, "actions", "acciones")}{!showVisits && <> · {durationText(row.totals.activeMs, language)} {tr(language, "active · approximate", "activo · aproximado")}</>}</small></li>)}</ul>
  </article>;
}

export default function AnalyticsWorkspace({ language }: { language: Language }) {
  const [preset, setPreset] = useState<Preset>("30");
  const [range, setRange] = useState(() => presetRange(30));
  const [context, setContext] = useState<UsageContext | "all">("all");
  const [projectId, setProjectId] = useState("");
  const [includeOwner, setIncludeOwner] = useState(false);
  const [projectOptions, setProjectOptions] = useState<ProjectOption[]>([]);
  const [result, setResult] = useState<{ key: string; data: UsageAnalyticsResponse } | null>(null);
  const [error, setError] = useState<"forbidden" | "request" | "">("");
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const today = todayInCostaRica();
  const earliest = shiftDay(today, -89);
  const validationError = rangeError(range.from, range.to, today, language);
  const params = new URLSearchParams({ from: range.from, to: range.to, context, includeOwner: String(includeOwner) });
  if (context === "project" && projectId) params.set("projectId", projectId);
  const query = params.toString();
  const requestKey = `${query}:${revision}`;
  const data = result?.key === requestKey && !validationError ? result.data : null;

  useEffect(() => {
    if (validationError) return;
    const controller = new AbortController();
    let current = true;
    const timer = window.setTimeout(() => {
      setLoading(true); setError("");
      void (async () => {
        try {
          const response = await fetch(`/api/admin/analytics?${query}`, { cache: "no-store", signal: controller.signal });
          if (!response.ok) throw new Error(response.status === 403 ? "forbidden" : "request");
          const payload = await response.json() as UsageAnalyticsResponse;
          if (!current) return;
          setProjectOptions(payload.projectOptions);
          setResult({ key: requestKey, data: payload });
        } catch (reason) {
          if (current && !controller.signal.aborted) { setResult(null); setError(reason instanceof Error && reason.message === "forbidden" ? "forbidden" : "request"); }
        } finally { if (current) setLoading(false); }
      })();
    }, 0);
    return () => { current = false; controller.abort(); window.clearTimeout(timer); };
  }, [query, requestKey, validationError]);

  const choosePreset = (next: Preset) => { setPreset(next); if (next !== "custom") setRange(presetRange(Number(next))); };
  const reset = () => { setPreset("30"); setRange(presetRange(30)); setContext("all"); setProjectId(""); setIncludeOwner(false); setRevision((value) => value + 1); };
  const hasUsage = data && Object.values(data.totals).some((value) => value > 0);
  const errorMessage = error === "forbidden"
    ? tr(language, "Platform administrator access is required to view these metrics.", "Necesitas acceso de administrador de la plataforma para ver estas métricas.")
    : tr(language, "Usage metrics could not be loaded. Try again.", "No se pudieron cargar las métricas de uso. Inténtalo de nuevo.");
  const visitorHelp = tr(language, "Estimated distinct browsers. A person using several browsers or devices can count more than once; this is separate from signed-in users.", "Navegadores distintos estimados. Una persona con varios navegadores o dispositivos puede contar más de una vez; es distinto de los usuarios con sesión.");
  const metrics = data ? [
    { key: "visits", label: tr(language, "Visits", "Visitas"), value: numberText(data.totals.visits, language), note: context === "project" ? tr(language, "Project entries per session", "Entradas a proyectos por sesión") : tr(language, "App sessions", "Sesiones en la app") },
    { key: "visitors", label: tr(language, "Estimated visitors", "Visitantes estimados"), value: numberText(data.totals.visitors, language), note: tr(language, "Distinct browsers", "Navegadores distintos"), help: visitorHelp },
    { key: "users", label: tr(language, "Signed-in users", "Usuarios con sesión"), value: numberText(data.totals.users, language), note: tr(language, "Distinct accounts", "Cuentas distintas") },
    { key: "views", label: tr(language, "Views", "Vistas"), value: numberText(data.totals.views, language), note: tr(language, "Sections opened", "Secciones abiertas") },
    { key: "actions", label: tr(language, "Actions", "Acciones"), value: numberText(data.totals.actions, language), note: tr(language, "Completed interactions", "Interacciones completadas") },
    { key: "activeMs", label: tr(language, "Active time · approximate", "Tiempo activo · aproximado"), value: durationText(data.totals.activeMs, language), note: tr(language, "While the app is visible", "Mientras la app está visible") },
  ] : [];

  return <section className="analytics-workspace">
    <div className="page-intro"><div><span className="overline">{tr(language, "PLATFORM ADMINISTRATION", "ADMINISTRACIÓN DE LA PLATAFORMA")}</span><h2>{tr(language, "App usage", "Uso de la app")}</h2><p>{tr(language, "See visits, active users and interactions across House Planner.", "Consulta visitas, usuarios activos e interacciones en House Planner.")}</p></div><span className="analytics-private">{tr(language, "Administrator only", "Solo administrador")}</span></div>
    <div className="card analytics-filters">
      <fieldset className="analytics-period"><legend>{tr(language, "Date range", "Período")}</legend><div>{(["1", "7", "30", "90", "custom"] as const).map((value) => <button key={value} type="button" aria-pressed={preset === value} className={preset === value ? "selected" : ""} onClick={() => choosePreset(value)}>{value === "1" ? tr(language, "Today", "Hoy") : value === "custom" ? tr(language, "Custom", "Personalizado") : `${value} ${tr(language, "days", "días")}`}</button>)}</div></fieldset>
      <div className="analytics-filter-grid">
        <label><span>{tr(language, "From", "Desde")}</span><input type="date" value={range.from} min={earliest} max={range.to < today ? range.to : today} onChange={(event) => { setPreset("custom"); setRange((value) => ({ ...value, from: event.target.value })); }} /></label>
        <label><span>{tr(language, "To", "Hasta")}</span><input type="date" value={range.to} min={range.from > earliest ? range.from : earliest} max={today} onChange={(event) => { setPreset("custom"); setRange((value) => ({ ...value, to: event.target.value })); }} /></label>
        <label><span>{tr(language, "Context", "Contexto")}</span><select aria-label={tr(language, "Context", "Contexto")} value={context} onChange={(event) => { const next = event.target.value as typeof context; setContext(next); if (next !== "project") setProjectId(""); }}><option value="all">{tr(language, "Entire app", "Toda la app")}</option><option value="access">{tr(language, "Access and sign-in", "Acceso e inicio de sesión")}</option><option value="demo">{tr(language, "Demo", "Demo")}</option><option value="project">{tr(language, "Projects", "Proyectos")}</option></select></label>
        <label><span>{tr(language, "Project", "Proyecto")}</span><select aria-label={tr(language, "Project", "Proyecto")} value={projectId} disabled={context !== "project"} onChange={(event) => setProjectId(event.target.value)}><option value="">{tr(language, "All projects", "Todos los proyectos")}</option>{projectOptions.map((project) => <option key={project.projectId} value={project.projectId}>{project.name}</option>)}</select></label>
      </div>
      <div className="analytics-filter-footer"><label className="analytics-owner-choice"><input type="checkbox" checked={includeOwner} onChange={(event) => setIncludeOwner(event.target.checked)} /><span>{tr(language, "Include my activity", "Incluir mi actividad")}</span></label><span className="analytics-caption">{tr(language, "Costa Rica time · maximum 90 days", "Hora de Costa Rica · máximo 90 días")}</span><button type="button" className="secondary-button" onClick={reset}>{tr(language, "Reset filters", "Restablecer filtros")}</button></div>
    </div>
    {validationError && <p className="analytics-error" role="alert">{validationError}</p>}
    {!validationError && error && <div className="analytics-error" role="alert"><p>{errorMessage}</p>{error !== "forbidden" && <button type="button" className="secondary-button" onClick={() => setRevision((value) => value + 1)}>{tr(language, "Try again", "Intentar de nuevo")}</button>}</div>}
    {!validationError && !error && (loading || !data) && <div className="card analytics-loading" role="status">{tr(language, "Loading usage metrics…", "Cargando métricas de uso…")}</div>}
    {data && <>
      <p className="analytics-measurement-note">{data.metadata.startedAt ? tr(language, `Measurement started ${timestampText(data.metadata.startedAt, language)}.`, `La medición comenzó el ${timestampText(data.metadata.startedAt, language)}.`) : tr(language, "Measurement begins when new visits and interactions are recorded.", "La medición comienza al registrarse nuevas visitas e interacciones.")} {tr(language, "Previous activity is not reconstructed. Active time is approximate.", "No se reconstruye actividad anterior. El tiempo activo es aproximado.")}</p>
      <div className="metric-grid analytics-metrics">{metrics.map((metric, index) => <article className={`metric-card ${["", "blue", "sand", "violet"][index % 4]}`} key={metric.key}><span>{metric.label}{metric.help && <button type="button" className="analytics-help" title={metric.help} aria-label={metric.help}>?</button>}</span><strong>{metric.value}</strong><small>{metric.note}</small></article>)}</div>
      {!hasUsage && <div className="card analytics-empty"><h3>{tr(language, "No usage in this period", "Sin uso en este período")}</h3><p>{tr(language, "New recorded visits and interactions will appear here. You can change the dates or reset the filters.", "Las nuevas visitas e interacciones registradas aparecerán aquí. Puedes cambiar las fechas o restablecer los filtros.")}</p><button type="button" className="secondary-button" onClick={reset}>{tr(language, "Reset filters", "Restablecer filtros")}</button></div>}
      {hasUsage && <>
        <DailyChart daily={data.daily} language={language} />
        <div className="analytics-breakdowns"><Breakdown title={tr(language, "Projects", "Proyectos")} overline={tr(language, "PROJECT COMPARISON", "COMPARACIÓN DE PROYECTOS")} rows={data.projects.map((project) => ({ id: project.projectId, name: project.name, totals: project }))} language={language} /><Breakdown title={tr(language, "Sections", "Secciones")} overline={tr(language, "MOST USED SECTIONS", "SECCIONES MÁS USADAS")} rows={data.sections.map((section) => ({ id: section.section, name: sectionText(section.section, language), totals: section }))} language={language} showVisits={false} /></div>
        <article className="card analytics-users"><div className="section-head"><div><span className="overline">{tr(language, "SIGNED-IN ACTIVITY", "ACTIVIDAD CON SESIÓN")}</span><h3>{tr(language, "Users", "Usuarios")}</h3></div></div><p className="analytics-caption">{tr(language, "Visits without sign-in are counted above and have no named user row.", "Las visitas sin sesión se cuentan arriba y no tienen una fila de usuario identificado.")}</p>
          {!data.users.length ? <p className="analytics-caption">{tr(language, "No signed-in users in this range.", "Sin usuarios con sesión en este rango.")}</p> : <div className="analytics-table-scroll" role="region" aria-label={tr(language, "Usage by user", "Uso por usuario")} tabIndex={0}><table><caption className="analytics-sr-only">{tr(language, "Activity by signed-in user, Costa Rica time", "Actividad por usuario con sesión, hora de Costa Rica")}</caption><thead><tr><th scope="col">{tr(language, "User", "Usuario")}</th><th scope="col">{tr(language, "Last activity", "Última actividad")}</th><th scope="col">{tr(language, "Views", "Vistas")}</th><th scope="col">{tr(language, "Actions", "Acciones")}</th><th scope="col">{tr(language, "Active time · approximate", "Tiempo activo · aproximado")}</th></tr></thead><tbody>{data.users.map((user) => <tr key={user.uid}><th scope="row"><b>{user.name || user.email || tr(language, "User", "Usuario")}</b><small>{user.email}</small></th><td><time dateTime={user.lastAt}>{timestampText(user.lastAt, language)}</time></td><td>{numberText(user.views, language)}</td><td>{numberText(user.actions, language)}</td><td>{durationText(user.activeMs, language)}</td></tr>)}</tbody></table></div>}
        </article>
      </>}
    </>}
  </section>;
}
