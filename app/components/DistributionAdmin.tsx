"use client";
import { useEffect, useState } from "react";
import { modelSources, parseHouseModel, type DistributionRequest } from "@/lib/house-distribution";

export default function DistributionAdmin({ language, documents, onReady }: { language: "en" | "es"; documents: { id: string; name: string; contentType: string }[]; onReady: () => void }) {
  const es = language === "es", tr = (en: string, esText: string) => es ? esText : en;
  const [request, setRequest] = useState<DistributionRequest | null>(null), [selected, setSelected] = useState<string[]>([]), [notes, setNotes] = useState(""), [preparationNotes, setPreparationNotes] = useState("");
  const [revision, setRevision] = useState(0), [busy, setBusy] = useState(false), [error, setError] = useState(""), [loaded, setLoaded] = useState(false);
  const load = async () => {
    try { const results = await Promise.all([fetch("/api/house-distribution/requests", { cache: "no-store" }), fetch("/api/house-distribution?status=1", { cache: "no-store" })]);
      const [requestData, modelData] = await Promise.all(results.map(r => r.json()));
      if (!results[0].ok || !results[1].ok) throw new Error(requestData.error || modelData.error);
      setRequest(requestData.request); setRevision(modelData.revision); setSelected(requestData.request?.sourceDocumentIds || []); setPreparationNotes(requestData.request?.preparationNotes || ""); setLoaded(true); setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to load request"); }
  };
  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, []);
  const mutate = async (url: string, method: string, body: unknown) => {
    setBusy(true); setError(""); try { const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); const data = await response.json(); if (!response.ok) throw new Error(data.error); await load(); if (data.record) onReady(); } catch (e) { setError(e instanceof Error ? e.message : "Unable to save request"); } finally { setBusy(false); }
  };
  const supported = documents.filter(d => /^(application\/pdf|image\/(png|jpeg|webp))$/.test(d.contentType));
  return <section className="card distribution-admin"><header><div><span className="distribution-eyebrow">{tr("PROJECT SETTINGS", "CONFIGURACIÓN DEL PROYECTO")}</span><h2>{tr("3D house distribution", "Distribución 3D de la casa")}</h2></div><span className="distribution-badge">{request?.status === "ready" ? tr("Ready", "Listo") : request?.status === "in_preparation" ? tr("In preparation", "En preparación") : request ? tr("Requested", "Solicitado") : tr("On demand", "Bajo solicitud")}</span></header>
    <p>{tr("A prepared model connects your rooms to measurements and fixtures. Uploading documents does not generate a model. Requests are prepared separately.", "Un modelo preparado conecta los espacios con medidas y equipos. Cargar documentos no genera un modelo. Las solicitudes se preparan por separado.")}</p>
    {error && <p role="alert">{error} <button onClick={load}>{tr("Reload", "Recargar")}</button></p>}
    {!request && <form className="distribution-form" onSubmit={e => { e.preventDefault(); void mutate("/api/house-distribution/requests", "POST", { sourceDocumentIds: selected, notes }); }}><fieldset><legend>{tr("Blueprint documents", "Documentos de planos")}</legend>{supported.map(d => <label key={d.id}><input type="checkbox" checked={selected.includes(d.id)} onChange={e => setSelected(e.target.checked ? [...selected, d.id] : selected.filter(id => id !== d.id))} />{d.name}</label>)}{!supported.length && <p>{tr("Upload your blueprints in Documents first.", "Primero carga los planos en Documentos.")}</p>}</fieldset><label>{tr("Notes for preparation", "Notas para la preparación")}<textarea value={notes} onChange={e => setNotes(e.target.value)} maxLength={2000} /></label><button disabled={busy || !loaded || !selected.length || selected.length > 12}>{tr("Request 3D distribution", "Solicitar distribución 3D")}</button></form>}
    {request && <><p>{request.notes}</p><p>{request.preparationNotes}</p><p>{tr("Blueprints", "Planos")}: {request.sourceDocumentIds.map(id => documents.find(d => d.id === id)?.name || tr("Unavailable document", "Documento no disponible")).join(", ")}</p></>}
    <details className="distribution-preparation"><summary>{tr("Admin · Prepare and import model", "Admin · Preparar e importar modelo")}</summary>
      {request && request.status !== "ready" && <form className="distribution-form" onSubmit={e => { e.preventDefault(); void mutate("/api/house-distribution/requests", "PATCH", { revision: request.revision, preparationNotes }); }}><label>{tr("Preparation notes", "Notas de preparación")}<textarea value={preparationNotes} onChange={e => setPreparationNotes(e.target.value)} maxLength={2000} /></label><button disabled={busy || !loaded}>{request.status === "requested" ? tr("Start preparation", "Iniciar preparación") : tr("Save preparation notes", "Guardar notas")}</button></form>}
      <p>{tr("Import a reviewed model package. The section becomes available only after the import succeeds. Existing corrections are preserved for matching room and fixture IDs.", "Importa un paquete de modelo revisado. La sección aparece solo después de una importación exitosa. Las correcciones existentes se conservan para espacios y equipos con el mismo identificador.")}</p>
      <label>{tr("Source blueprint for prepared package", "Plano de origen del paquete preparado")}<select value={selected[0] || ""} onChange={e => setSelected(e.target.value ? [e.target.value] : [])}><option value="">{tr("Choose document", "Selecciona documento")}</option>{supported.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
      <label className="distribution-import">{tr("Import reviewed model (.json)", "Importar modelo revisado (.json)")}<input type="file" accept=".json,application/json" disabled={busy || !loaded} onChange={async e => {
        const file = e.target.files?.[0]; e.target.value = ""; if (!file) return;
        try {
          if (file.size > 750_000) throw new Error(tr("Model package is too large", "El paquete es demasiado grande"));
          const raw = parseHouseModel(JSON.parse(await file.text()));
          if (raw.sourceDocumentIds?.includes("blueprint")) {
            if (!selected[0]) throw new Error(tr("Select the matching source blueprint first", "Selecciona primero el plano de origen"));
            // Replace source identifiers only, never free text or arbitrary package content.
            raw.sourceDocumentIds = raw.sourceDocumentIds.map((id: string) => id === "blueprint" ? selected[0] : id);
            const sources = modelSources(raw);
            for (const source of sources) if (source?.documentId === "blueprint") source.documentId = selected[0];
          }
          const model = parseHouseModel(raw); await mutate("/api/house-distribution", "POST", { model, revision });
        } catch (e) { setError(e instanceof Error ? e.message : "Invalid model"); }
      }} /></label>
    </details>
  </section>;
}
