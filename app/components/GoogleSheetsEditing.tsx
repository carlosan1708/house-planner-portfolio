"use client";
import { useEffect, useState } from "react";

type Connection = { configured: boolean; managed?: boolean; connected: boolean; canCreate: boolean; url: string; folderUrl: string; error?: string };
export default function GoogleSheetsEditing({ language, busy = false, onSynced, onWorkingChange }: { language: "en" | "es"; busy?: boolean; onSynced?: () => void | Promise<void>; onWorkingChange?: (working: boolean) => void }) {
  const [connection, setConnection] = useState<Connection | null>(null);
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const es = language === "es";
  useEffect(() => {
    let active = true;
    const refresh = () => { void fetch("/api/google-sheets", { cache: "no-store" }).then(async (response) => {
      if (!response.ok) throw new Error("Connection unavailable");
      const result = await response.json(); if (active) setConnection(result);
    }).catch(() => { if (active) setError(es ? "No se pudo consultar la conexión." : "Could not check the connection."); }); };
    refresh(); window.addEventListener("focus", refresh);
    return () => { active = false; window.removeEventListener("focus", refresh); };
  }, [es]);
  async function synchronize(useGoogle = false) {
    if (useGoogle && !window.confirm(es ? "¿Usar la versión de Google como presupuesto actual? Los cambios del proyecto quedan en el historial. Descarga ambas versiones primero si necesitas conciliarlas." : "Use Google's version as the current budget? Project changes remain in history. Download both versions first if you need to merge them.")) return;
    setWorking(true); onWorkingChange?.(true); setError("");
    try {
      const response = await fetch("/api/google-sheets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: useGoogle ? "use-google" : connection?.url ? "sync" : "ensure" }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error);
      setConnection((previous) => previous ? { ...previous, ...result, error: "" } : previous); await onSynced?.();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Google unavailable"); }
    finally { setWorking(false); onWorkingChange?.(false); }
  }
  return <section className="google-editing-panel"><div><b>{es ? "Presupuesto consolidado · Google Sheets" : "Consolidated budget · Google Sheets"}</b><p>{es ? "Una sola hoja para todo el proyecto. Guarda aquí los cambios o edita en Google. Descarga XLSX para trabajar sin conexión y vuelve a subirlo para actualizar la misma hoja." : "One spreadsheet for the project. Save changes here or edit in Google. Download XLSX for offline work and upload it again to update the same spreadsheet."}</p></div>
    {(error || connection?.error) && <p role="alert">{error || connection?.error} <a href="/api/workbook/file?source=local">{es ? "Descargar versión del proyecto" : "Download project version"}</a></p>}
    {connection && !connection.configured && <p>{es ? "La conexión necesita configuración del servidor." : "Server setup required."}</p>}
    {connection?.managed && connection.connected && <p>{es ? "Acceso privado administrado por el servidor. No necesitas conectar tu cuenta de Google para guardar aquí." : "Private access managed by the server. You do not need to connect your Google account to save here."}</p>}
    {connection?.configured && !connection.connected && <a className="secondary-button link-button" href="/api/google-sheets/connect" target="_blank" rel="noopener noreferrer">{es ? "Conectar Google" : "Connect Google"}</a>}
    {connection?.connected && <div className="budget-actions">
      {connection.url && <a className="secondary-button link-button" href={connection.url} target="_blank" rel="noopener noreferrer">{es ? "Abrir hoja consolidada ↗" : "Open consolidated spreadsheet ↗"}</a>}
      {connection.folderUrl && <a className="secondary-button link-button" href={connection.folderUrl} target="_blank" rel="noopener noreferrer">{es ? "Carpeta de Drive ↗" : "Drive folder ↗"}</a>}
      {connection.url && connection.canCreate && (error || connection.error) && <button className="secondary-button" disabled={busy || working} onClick={() => void synchronize(true)}>{es ? "Usar versión de Google" : "Use Google version"}</button>}
      {(connection.url || connection.canCreate) && <button className="primary-button" disabled={busy || working} onClick={() => void synchronize()}>{working ? (es ? "Sincronizando…" : "Syncing…") : connection.url ? (es ? "Actualizar desde Google" : "Refresh from Google") : (es ? "Activar hoja consolidada" : "Activate consolidated spreadsheet")}</button>}
    </div>}
  </section>;
}
