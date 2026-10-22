"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import "./document-search.css";

export type SearchableDocument = {
  id: string;
  name: string;
  description?: string;
  folderId: string | null;
  downloadUrl: string;
  previewKind?: string | null;
  previewUrl?: string | null;
  encrypted?: boolean;
};
type SearchFolder = { id: string; name: string; parentId: string | null; encrypted?: boolean; unlocked?: boolean };
type SearchState = { key: string; ids?: string[]; message?: string; loading?: boolean };
const normalize = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase();

export default function DocumentSearch({ projectId, language, mode, allowSemantic, documents, folders, query, onQueryChange, onPreview, onOpenFolder }: {
  projectId: string;
  language: "en" | "es";
  mode: "real" | "demo";
  allowSemantic: boolean;
  documents: SearchableDocument[];
  folders: SearchFolder[];
  query: string;
  onQueryChange: (query: string) => void;
  onPreview: (id: string) => void;
  onOpenFolder: (folderId: string | null) => void;
}) {
  const text = (en: string, es: string) => language === "es" ? es : en;
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const request = useRef<AbortController | null>(null);
  const [semantic, setSemantic] = useState<SearchState | null>(null);
  const candidates = useMemo(() => {
    const byId = new Map(folders.map(folder => [folder.id, folder]));
    return documents.flatMap(document => {
      const path: SearchFolder[] = [], seen = new Set<string>();
      let next = document.folderId;
      while (next) {
        const folder = byId.get(next);
        // A partial, cyclic or locked path is not a searchable location.
        if (!folder || seen.has(next) || (folder.encrypted && !folder.unlocked)) return [];
        seen.add(next); path.unshift(folder); next = folder.parentId;
      }
      if (document.encrypted && !path.some(folder => folder.encrypted && folder.unlocked)) return [];
      return [{ document, path: path.map(folder => folder.name).join(" / "), protected: path.some(folder => folder.encrypted) }];
    });
  }, [documents, folders]);
  const trimmed = query.trim();
  const context = JSON.stringify([projectId, language, mode, allowSemantic, trimmed, candidates.map(({ document, path, protected: protectedPath }) => [document.id, document.name, document.description, document.folderId, document.downloadUrl, document.previewUrl, path, protectedPath])]);
  const currentContext = useRef(context);
  useEffect(() => {
    currentContext.current = context;
    request.current?.abort();
    return () => request.current?.abort();
  }, [context]);
  const active = semantic?.key === context ? semantic : null;
  const textual = candidates.filter(({ document, path }) => normalize(`${document.name} ${document.description || ""} ${path}`).includes(normalize(trimmed)));
  const byId = new Map(candidates.map(candidate => [candidate.document.id, candidate]));
  const semanticIds = new Set(active?.ids || []);
  const results = trimmed ? [...(active?.ids || []).flatMap(id => {
    const candidate = byId.get(id);
    return candidate && !candidate.protected ? [candidate] : [];
  }), ...textual.filter(candidate => !semanticIds.has(candidate.document.id))] : [];
  const cancel = () => {
    request.current?.abort(); request.current = null;
    setSemantic(null);
  };
  const clear = () => { cancel(); onQueryChange(""); input.current?.focus(); };
  const searchMeaning = async () => {
    if (trimmed.length < 3 || active?.loading) return;
    if (mode === "demo" || !allowSemantic) {
      setSemantic({ key: context, message: mode === "demo" ? text("Search by meaning is available in the real project. Text search stays available here.", "La búsqueda por significado está disponible en el proyecto real. Aquí podés buscar por texto.") : text("This shared link supports text search. Sign in to search by meaning.", "Este enlace compartido permite buscar por texto. Iniciá sesión para buscar por significado.") });
      return;
    }
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    const key = context;
    setSemantic({ key, loading: true });
    try {
      const response = await fetch("/api/documents/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: trimmed, language }), cache: "no-store", signal: controller.signal });
      const data = await response.json() as { results?: { id?: unknown }[]; code?: string; mode?: string };
      if (controller.signal.aborted || currentContext.current !== key) return;
      if (!response.ok || data.mode !== "semantic" || !Array.isArray(data.results)) {
        const message = data.code === "search_limit" ? text("Search limit reached. Try again later; text results are still available.", "Se alcanzó el límite de búsquedas. Intentá más tarde; los resultados de texto siguen disponibles.")
          : data.code === "semantic_scope_limit" ? text("There are too many documents for this search by meaning. Text search still covers your accessible folders.", "Hay demasiados documentos para esta búsqueda por significado. El texto sigue buscando en tus carpetas accesibles.")
          : data.code === "invalid_query" ? text("Use a short description of the document you need. Text results are still available.", "Usá una descripción breve del documento que necesitás. Los resultados de texto siguen disponibles.")
          : data.code === "denied" ? text("Search by meaning is not available with your current access. Text results are still available.", "Tu acceso actual no permite buscar por significado. Los resultados de texto siguen disponibles.")
          : text("Search by meaning is unavailable right now. Showing text matches; you can try again.", "La búsqueda por significado no está disponible ahora. Se muestran coincidencias de texto; podés reintentar.");
        setSemantic({ key, message }); return;
      }
      const ids = [...new Set(data.results.flatMap(item => typeof item?.id === "string" && byId.has(item.id) && !byId.get(item.id)!.protected ? [item.id] : []))];
      setSemantic({ key, ids });
    } catch {
      if (!controller.signal.aborted && currentContext.current === key) setSemantic({ key, message: text("Search by meaning could not connect. Your text results are still available.", "No se pudo conectar la búsqueda por significado. Tus resultados de texto siguen disponibles.") });
    } finally {
      if (request.current === controller) request.current = null;
    }
  };
  return <section className="document-search" aria-label={text("Search all documents", "Buscar en todos los documentos")}>
    <form onSubmit={event => { event.preventDefault(); void searchMeaning(); }} onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); if (active?.loading) { cancel(); input.current?.focus(); } else clear(); } }}>
      <label htmlFor={inputId}>{text("Find a document", "Encontrar un documento")}</label>
      <div className="document-search-controls">
        <input ref={input} id={inputId} type="search" value={query} maxLength={400} placeholder={text("Name or description, e.g. permission to build…", "Nombre o descripción, ej. permiso para construir…")} onChange={event => { cancel(); onQueryChange(event.target.value); }} aria-describedby={`${inputId}-help`} />
        {query && <button type="button" className="secondary-button document-search-clear" onClick={clear}>{text("Clear", "Limpiar")}</button>}
        <button type="submit" className="primary-button document-search-meaning" disabled={trimmed.length < 3 || active?.loading === true}>{active?.loading ? text("Searching…", "Buscando…") : text("Search by meaning", "Buscar por significado")}</button>
        {active?.loading && <button type="button" className="secondary-button" onClick={() => { cancel(); input.current?.focus(); }}>{text("Cancel", "Cancelar")}</button>}
      </div>
      <p id={`${inputId}-help`}>{text("Search all your accessible folders by name, description or path. Search by meaning also finds related descriptions.", "Buscá por nombre, descripción o ruta en todas tus carpetas accesibles. Por significado también encuentra descripciones relacionadas.")}</p>
    </form>
    {active?.message && <p className="document-search-message" role="status">{active.message}</p>}
    {trimmed && <div className="document-search-results" aria-busy={active?.loading === true}>
      <div className="document-search-summary" role="status">{results.length} {text(results.length === 1 ? "document found" : "documents found", results.length === 1 ? "documento encontrado" : "documentos encontrados")}{active?.loading && ` · ${text("Searching by meaning…", "Buscando por significado…")}`}</div>
      {!results.length && !active?.loading && <p className="document-search-empty">{text("No matches yet. Try another description or search by meaning.", "No hay coincidencias. Probá otra descripción o buscá por significado.")}</p>}
      {results.map(({ document, path }) => <article className="document-search-result" key={document.id}>
        <div className="document-search-result-body">
          {document.previewUrl && document.previewKind ? <button type="button" className="document-search-title" onClick={() => onPreview(document.id)}>{document.name}</button> : <strong>{document.name}</strong>}
          {document.description && <p>{document.description}</p>}
          <button type="button" className="document-search-path" aria-label={text(`Open folder for ${document.name}: ${path || "Unfiled"}`, `Abrir carpeta de ${document.name}: ${path || "Sin carpeta"}`)} onClick={() => onOpenFolder(document.folderId)}>{path || text("Unfiled", "Sin carpeta")} <span aria-hidden="true">↗</span></button>
        </div>
        <div className="document-search-result-actions">
          <span className="document-search-match">{semanticIds.has(document.id) ? text("By meaning", "Por significado") : text("By text", "Por texto")}</span>
          {document.previewUrl && document.previewKind ? <button type="button" className="secondary-button" aria-label={text(`Open ${document.name}`, `Abrir ${document.name}`)} onClick={() => onPreview(document.id)}>{text("Open", "Abrir")}</button> : <a className="secondary-button" href={document.downloadUrl} download aria-label={text(`Download ${document.name}`, `Descargar ${document.name}`)}>{text("Download", "Descargar")}</a>}
        </div>
      </article>)}
    </div>}
  </section>;
}
