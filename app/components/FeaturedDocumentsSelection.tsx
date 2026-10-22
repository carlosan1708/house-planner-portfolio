"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { applyFeaturedDocumentsChange, diffFeaturedDocumentIds, FEATURED_DOCUMENT_LIMIT, featuredDocumentId, normalizeFeaturedDocumentIds, parseFeaturedDocumentsChange, type FeaturedDocumentsChange } from "@/lib/featured-documents";
import "./featured-documents.css";

type Language = "en" | "es";
type SelectionError = "load" | "save" | "limit" | null;
export type FeaturedDocumentCandidate = { id: string; name: string; description?: string | null; folderId?: string | null; contentType?: string; size?: number };
export type FeaturedDocumentFolder = { id: string; name: string; parentId?: string | null };
export type FeaturedDocumentsSelectionState = {
  documentIds: string[]; loading: boolean; error: SelectionError; saving: boolean;
  retry: () => void; save: (change: FeaturedDocumentsChange) => Promise<boolean>;
};
type HookOptions = { mode: "demo" | "real"; projectId: string; enabled: boolean; demoIds: string[]; onDemoChange: (ids: string[]) => void };
type RemoteSelection = { key: string; documentIds: string[]; loading: boolean; error: SelectionError };

function responseIds(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value) || !("documentIds" in value)) throw new Error("Invalid selection response");
  const ids = (value as { documentIds: unknown }).documentIds;
  if (!Array.isArray(ids) || ids.length > FEATURED_DOCUMENT_LIMIT || ids.some(id => !featuredDocumentId(id)) || new Set(ids).size !== ids.length) throw new Error("Invalid selection response");
  return [...ids];
}

/** Shared project reads are authorized by the server; demo changes stay in parent-owned state. */
export function useFeaturedDocumentsSelection({ mode, projectId, enabled, demoIds, onDemoChange }: HookOptions): FeaturedDocumentsSelectionState {
  const key = `${mode}:${projectId}`;
  const [remote, setRemote] = useState<RemoteSelection>({ key, documentIds: [], loading: mode === "real" && enabled, error: null });
  const [saving, setSaving] = useState(false);
  const [reload, setReload] = useState(0);
  const epoch = useRef(0);
  const saveController = useRef<AbortController | null>(null);
  const inFlight = useRef(false);

  useEffect(() => {
    const generation = ++epoch.current;
    const controller = new AbortController();
    inFlight.current = false;
    // Defer the initial state synchronization to the asynchronous read lifecycle.
    const begin = window.setTimeout(() => {
      setSaving(false);
      setRemote(previous => ({ key, documentIds: previous.key === key ? previous.documentIds : [], loading: mode === "real" && enabled, error: null }));
    }, 0);
    if (mode === "real" && enabled) {
      void (async () => {
        try {
          const response = await fetch("/api/documents/featured", { cache: "no-store", signal: controller.signal });
          if (!response.ok) throw new Error("Selection read failed");
          const ids = responseIds(await response.json());
          if (!controller.signal.aborted && epoch.current === generation) {
            window.clearTimeout(begin);
            setSaving(false); setRemote({ key, documentIds: ids, loading: false, error: null });
          }
        } catch {
          if (!controller.signal.aborted && epoch.current === generation) {
            window.clearTimeout(begin);
            setSaving(false); setRemote(previous => ({ key, documentIds: previous.key === key ? previous.documentIds : [], loading: false, error: "load" }));
          }
        }
      })();
    }
    return () => { window.clearTimeout(begin); controller.abort(); saveController.current?.abort(); epoch.current = generation + 1; };
  }, [enabled, key, mode, reload]);

  const loading = mode === "real" && enabled && (remote.key !== key || remote.loading);
  const error = remote.key === key ? remote.error : null;
  const retry = useCallback(() => { if (enabled && !inFlight.current) setReload(value => value + 1); }, [enabled]);
  const save = useCallback(async (change: FeaturedDocumentsChange) => {
    if (!enabled || inFlight.current || (mode === "real" && (loading || remote.key !== key || error === "load"))) return false;
    const parsed = parseFeaturedDocumentsChange(change);
    if (!parsed) { setRemote(previous => ({ ...previous, key, error: "save" })); return false; }
    const generation = epoch.current;
    inFlight.current = true; setSaving(true);
    setRemote(previous => ({ ...previous, key, error: null }));
    const controller = new AbortController(); saveController.current = controller;
    try {
      if (mode === "demo") onDemoChange(applyFeaturedDocumentsChange(demoIds, parsed));
      else {
        const response = await fetch("/api/documents/featured", { method: "PATCH", cache: "no-store", signal: controller.signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify(parsed) });
        if (!response.ok) {
          if (response.status === 409) throw new RangeError("Selection limit reached");
          throw new Error("Selection save failed");
        }
        const ids = responseIds(await response.json());
        if (controller.signal.aborted || epoch.current !== generation) return false;
        setRemote({ key, documentIds: ids, loading: false, error: null });
      }
      return true;
    } catch (reason) {
      if (!controller.signal.aborted && epoch.current === generation) setRemote(previous => ({ ...previous, key, error: reason instanceof RangeError ? "limit" : "save" }));
      return false;
    } finally {
      if (epoch.current === generation) { inFlight.current = false; saveController.current = null; setSaving(false); }
    }
  }, [demoIds, enabled, error, key, loading, mode, onDemoChange, remote.key]);
  return { documentIds: !enabled ? [] : mode === "demo" ? normalizeFeaturedDocumentIds(demoIds) : remote.key === key ? remote.documentIds : [], loading, error, saving, retry, save };
}

function folderPath(folderId: string | null | undefined, folders: readonly FeaturedDocumentFolder[], language: Language) {
  if (!folderId) return language === "es" ? "Sin carpeta" : "Unfiled";
  const byId = new Map(folders.map(folder => [folder.id, folder]));
  const names: string[] = [], seen = new Set<string>();
  let current: string | null | undefined = folderId;
  while (current && !seen.has(current)) {
    seen.add(current); const folder = byId.get(current); if (!folder) break;
    names.unshift(folder.name); current = folder.parentId;
  }
  return names.join(" / ") || (language === "es" ? "Carpeta compartida" : "Shared folder");
}
const searchKey = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase();
function selectionErrorText(error: SelectionError, language: Language) {
  const texts = {
    load: ["Featured documents could not be loaded. Retry before changing the selection.", "No se pudieron cargar los documentos destacados. Reintenta antes de cambiar la selección."],
    save: ["The selection could not be saved. Your previous selection and this draft are unchanged. Try again.", "No se pudo guardar la selección. La selección anterior y este borrador se conservan. Inténtalo de nuevo."],
    limit: ["The project can feature up to 30 documents. Remove an eligible selection and try again.", "El proyecto puede destacar hasta 30 documentos. Quita una selección permitida e inténtalo de nuevo."],
  };
  return error ? texts[error][language === "es" ? 1 : 0] : "";
}

type Props = {
  language: Language; documents: readonly FeaturedDocumentCandidate[]; folders: readonly FeaturedDocumentFolder[];
  canManage: boolean; busy: boolean; selection: FeaturedDocumentsSelectionState;
};
export default function FeaturedDocumentsSelection({ language, documents, folders, canManage, busy, selection }: Props) {
  const [open, setOpen] = useState(false);
  const [baselineIds, setBaselineIds] = useState<string[]>([]);
  const [draftIds, setDraftIds] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [sourceFolder, setSourceFolder] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const headingId = useId();
  const t = (en: string, es: string) => language === "es" ? es : en;
  const locked = busy || selection.saving;
  const showDialog = open && canManage;
  useEffect(() => {
    if (!open || canManage) return;
    const timer = window.setTimeout(() => setOpen(false), 0);
    return () => window.clearTimeout(timer);
  }, [canManage, open]);
  useEffect(() => {
    const element = dialog.current;
    if (!showDialog || !element) return;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    element.showModal(); element.querySelector<HTMLInputElement>('input[type="search"]')?.focus({ preventScroll: true });
    const button = opener.current;
    return () => { element.close(); document.body.style.overflow = overflow; if (button?.isConnected) button.focus({ preventScroll: true }); };
  }, [showDialog]);
  const paths = useMemo(() => new Map(documents.map(document => [document.id, folderPath(document.folderId, folders, language)])), [documents, folders, language]);
  const query = searchKey(search.trim());
  const matches = documents.filter(document => (!sourceFolder || (sourceFolder === "unfiled" ? !document.folderId : document.folderId === sourceFolder.slice(7)))
    && searchKey(`${document.name} ${document.description || ""} ${paths.get(document.id) || ""}`).includes(query));
  const availableFolders = folders.filter(folder => documents.some(document => document.folderId === folder.id))
    .map(folder => ({ id: folder.id, path: folderPath(folder.id, folders, language) })).sort((a, b) => a.path.localeCompare(b.path));
  const openPicker = () => {
    if (locked || selection.loading || selection.error === "load") return;
    const represented = new Set(documents.map(document => document.id));
    const visibleIds = selection.documentIds.filter(id => represented.has(id));
    setBaselineIds([...visibleIds]); setDraftIds([...visibleIds]); setSearch(""); setSourceFolder(""); setOpen(true);
  };
  const toggle = (id: string) => setDraftIds(current => current.includes(id) ? current.filter(item => item !== id)
    : current.length < FEATURED_DOCUMENT_LIMIT ? [...current, id] : current);
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!canManage || locked || selection.loading || selection.error === "load") return;
    if (await selection.save(diffFeaturedDocumentIds(baselineIds, draftIds))) setOpen(false);
  };
  return <div className="featured-documents-tools">
    {canManage && <button ref={opener} type="button" className="secondary-button featured-documents-choose" disabled={locked || selection.loading || selection.error === "load"} onClick={openPicker}>☑ {t("Choose documents", "Seleccionar documentos")}</button>}
    {selection.loading && <p className="featured-documents-feedback" role="status">{t("Loading featured documents…", "Cargando documentos destacados…")}</p>}
    {selection.error && !showDialog && <div className="featured-documents-feedback" role="alert"><span>{selectionErrorText(selection.error, language)}</span>{selection.error === "load" && <button type="button" className="secondary-button" disabled={locked || selection.loading} onClick={selection.retry}>{t("Retry", "Reintentar")}</button>}</div>}
    {showDialog && <dialog ref={dialog} className="featured-documents-dialog" aria-labelledby={headingId} onCancel={event => { event.preventDefault(); if (!locked) setOpen(false); }} onClick={event => { if (!locked && event.target === event.currentTarget) setOpen(false); }}>
      <form onSubmit={event => void save(event)}>
        <header><div><h3 id={headingId}>{t("Choose featured documents", "Seleccionar documentos destacados")}</h3><p>{t("Choose entry points without moving files or changing their permissions.", "Selecciona accesos sin mover los archivos ni cambiar sus permisos.")}</p></div><button type="button" className="featured-documents-close" aria-label={t("Close selection", "Cerrar selección")} disabled={locked} onClick={() => setOpen(false)}>×</button></header>
        <div className="featured-documents-filters"><label><span>{t("Search documents", "Buscar documentos")}</span><input type="search" aria-label={t("Search documents", "Buscar documentos")} value={search} disabled={locked} onChange={event => setSearch(event.target.value)} placeholder={t("Name, description or folder path…", "Nombre, descripción o ruta de carpeta…")} /></label><label><span>{t("Folder", "Carpeta")}</span><select aria-label={t("Folder", "Carpeta")} value={sourceFolder} disabled={locked} onChange={event => setSourceFolder(event.target.value)}><option value="">{t("All folders", "Todas las carpetas")}</option><option value="unfiled">{t("Unfiled", "Sin carpeta")}</option>{availableFolders.map(folder => <option key={folder.id} value={`folder:${folder.id}`}>{folder.path}</option>)}</select></label></div>
        <p className="featured-documents-count" aria-live="polite">{draftIds.length} / {FEATURED_DOCUMENT_LIMIT} {t("selected", "seleccionados")}</p>
        <div className="featured-documents-candidates">{matches.length ? matches.map(document => { const checked = draftIds.includes(document.id); return <label className="featured-documents-candidate" key={document.id}><input type="checkbox" checked={checked} disabled={locked || (!checked && draftIds.length >= FEATURED_DOCUMENT_LIMIT)} onChange={() => toggle(document.id)} /><span><strong>{document.name}</strong><small>{paths.get(document.id)}</small>{document.description && <small>{document.description}</small>}</span></label>; }) : <p className="featured-documents-empty">{t("No eligible documents match these filters.", "No hay documentos permitidos que coincidan con estos filtros.")}</p>}</div>
        {selection.error && <p className="featured-documents-save-error" role="alert">{selectionErrorText(selection.error, language)}</p>}
        <footer><button type="button" className="secondary-button" disabled={locked} onClick={() => setOpen(false)}>{t("Cancel", "Cancelar")}</button><button type="submit" className="primary-button" disabled={locked || selection.loading || selection.error === "load"}>{selection.saving ? t("Saving…", "Guardando…") : t("Save selection", "Guardar selección")}</button></footer>
      </form>
    </dialog>}
  </div>;
}
