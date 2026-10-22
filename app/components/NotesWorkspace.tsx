"use client";

import { useEffect, useRef, useState } from "react";
import type { ProjectNote } from "@/lib/project-notes";
import { demoProjectNotes, localizeDemoNote } from "@/lib/demo-notes";
import "./notes.css";

type Language = "en" | "es";
const tr = (language: Language, en: string, es: string) => language === "es" ? es : en;
type Draft = { title: string; content: string; aiEnabled: boolean };
const emptyDraft = (): Draft => ({ title: "", content: "", aiEnabled: false });

type NotesWorkspaceProps = { language: Language; canEdit: boolean; mode?: "demo" | "real" };
export default function NotesWorkspace(props: NotesWorkspaceProps) {
  return <NotesWorkspaceContent key={props.mode || "real"} {...props} />;
}

function NotesWorkspaceContent({ language, canEdit, mode = "real" }: NotesWorkspaceProps) {
  const [notes, setNotes] = useState<ProjectNote[]>(() => mode === "demo" ? demoProjectNotes(language) : []);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(mode === "real");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const form = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!formOpen) return;
    form.current?.scrollIntoView({ block: "start" });
    form.current?.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true });
  }, [formOpen, editingId]);

  useEffect(() => {
    if (mode === "demo") return;
    let active = true;
    void fetch("/api/notes", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("load");
        return response.json() as Promise<{ notes: ProjectNote[] }>;
      })
      .then((data) => { if (active) setNotes(data.notes); })
      .catch(() => { if (active) setError(tr(language, "Could not load notes.", "No se pudieron cargar las notas.")); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [language, mode]);

  const ordered = (mode === "demo" ? notes.map((note) => localizeDemoNote(note, language)) : [...notes]).sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || "") || a.title.localeCompare(b.title));
  const visible = ordered.filter((note) => `${note.title} ${note.content}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));

  const openNew = () => { setDraft(emptyDraft()); setEditingId(null); setFormOpen(true); setError(""); };
  const openEdit = (note: ProjectNote) => { setDraft({ title: note.title, content: note.content, aiEnabled: note.aiEnabled }); setEditingId(note.id); setFormOpen(true); setError(""); };
  const save = async () => {
    if (!draft.title.trim() || !draft.content.trim()) return;
    setBusy(true); setError("");
    try {
      if (mode === "demo") {
        const now = new Date().toISOString();
        const original = notes.find((note) => note.id === editingId);
        const note: ProjectNote = { id: editingId || `demo-note-${crypto.randomUUID()}`, title: draft.title.trim(), content: draft.content.trim(), aiEnabled: draft.aiEnabled, createdBy: original?.createdBy || "demo", updatedBy: "demo", createdAt: original?.createdAt || now, updatedAt: now };
        setNotes((current) => [note, ...current.filter((item) => item.id !== note.id)]);
        setFormOpen(false); setEditingId(null); setDraft(emptyDraft());
        return;
      }
      const response = await fetch("/api/notes", { method: editingId ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...(editingId ? { id: editingId } : {}), ...draft }) });
      if (!response.ok) throw new Error("save");
      const data = await response.json() as { note: ProjectNote };
      setNotes((current) => [data.note, ...current.filter((note) => note.id !== data.note.id)]);
      setFormOpen(false); setEditingId(null); setDraft(emptyDraft());
    } catch {
      setError(tr(language, "Could not save the note. Try again.", "No se pudo guardar la nota. Inténtalo de nuevo."));
    } finally { setBusy(false); }
  };
  const toggleAi = async (note: ProjectNote, aiEnabled: boolean) => {
    setBusy(true); setError("");
    try {
      if (mode === "demo") {
        setNotes((current) => current.map((item) => item.id === note.id ? { ...item, aiEnabled, updatedAt: new Date().toISOString() } : item));
        if (editingId === note.id) setDraft((current) => ({ ...current, aiEnabled }));
        return;
      }
      const response = await fetch("/api/notes", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: note.id, title: note.title, content: note.content, aiEnabled }) });
      if (!response.ok) throw new Error("toggle");
      const data = await response.json() as { note: ProjectNote };
      setNotes((current) => current.map((item) => item.id === note.id ? data.note : item));
      if (editingId === note.id) setDraft((current) => ({ ...current, aiEnabled: data.note.aiEnabled }));
    } catch {
      setError(tr(language, "Could not change AI access.", "No se pudo cambiar el acceso de la IA."));
    } finally { setBusy(false); }
  };
  const remove = async (note: ProjectNote) => {
    if (!window.confirm(tr(language, `Delete “${note.title}”?`, `¿Eliminar “${note.title}”?`))) return;
    setBusy(true); setError("");
    try {
      if (mode === "demo") {
        setNotes((current) => current.filter((item) => item.id !== note.id));
        if (editingId === note.id) { setFormOpen(false); setEditingId(null); setDraft(emptyDraft()); }
        return;
      }
      const response = await fetch(`/api/notes?id=${encodeURIComponent(note.id)}`, { method: "DELETE" });
      if (!response.ok) throw new Error("delete");
      setNotes((current) => current.filter((item) => item.id !== note.id));
    } catch {
      setError(tr(language, "Could not delete the note.", "No se pudo eliminar la nota."));
    } finally { setBusy(false); }
  };

  return <section className="notes-workspace">
    <div className="page-intro"><div><span className="overline">{tr(language, "PROJECT MEMORY", "MEMORIA DEL PROYECTO")}</span><h2>{tr(language, "Notes and data", "Notas y datos")}</h2><p>{tr(language, "Save information for your project. Choose which notes the AI may consult when answering.", "Guarda información del proyecto. Elige qué notas puede consultar la IA al responder.")}</p></div>{canEdit && <button className="primary-button" onClick={openNew}>{tr(language, "+ New note", "+ Nueva nota")}</button>}</div>
    {mode === "demo" && <div className="notes-privacy" role="note">{tr(language, "Fictional project notes · try creating, editing, searching or changing AI access. Changes last for this visit and do not reach a real project.", "Notas ficticias del proyecto · prueba crear, editar, buscar o cambiar el acceso de la IA. Los cambios duran esta visita y no llegan a un proyecto real.")}</div>}
    <div className="notes-privacy">{tr(language, "AI access starts off for each new note. Turning it off stops the note from being consulted in new AI replies. Project members need Notes access to read it.", "El acceso de la IA inicia desactivado en cada nota. Al desactivarlo, la nota deja de consultarse en nuevas respuestas. Los miembros necesitan permiso de Notas para leerla.")}</div>
    {error && <p className="notes-error" role="alert">{error}</p>}
    {formOpen && canEdit && <form ref={form} className="notes-form card" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <h3>{editingId ? tr(language, "Edit note", "Editar nota") : tr(language, "New note", "Nueva nota")}</h3>
      <label><span>{tr(language, "Title", "Título")}</span><input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} maxLength={120} required /></label>
      <label><span>{tr(language, "Information or note", "Información o nota")}</span><textarea value={draft.content} onChange={(event) => setDraft({ ...draft, content: event.target.value })} maxLength={12000} rows={8} required /></label>
      <label className="notes-ai-choice"><input type="checkbox" checked={draft.aiEnabled} onChange={(event) => setDraft({ ...draft, aiEnabled: event.target.checked })} /><span>{tr(language, "Allow the AI to consult this note", "Permitir que la IA consulte esta nota")}</span></label>
      <div className="notes-form-actions"><button className="primary-button" type="submit" disabled={busy || !draft.title.trim() || !draft.content.trim()}>{busy ? tr(language, "Saving…", "Guardando…") : tr(language, "Save note", "Guardar nota")}</button><button className="secondary-button" type="button" disabled={busy} onClick={() => setFormOpen(false)}>{tr(language, "Cancel", "Cancelar")}</button></div>
    </form>}
    {!loading && notes.length > 0 && <label className="notes-search"><span>{tr(language, "Search notes", "Buscar notas")}</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={tr(language, "Search by title or text", "Buscar por título o texto")} /></label>}
    {loading ? <div className="editor-loading">{tr(language, "Loading notes…", "Cargando notas…")}</div> : visible.length === 0 ? <div className="notes-empty card"><h3>{search ? tr(language, "No matching notes", "No hay notas que coincidan") : tr(language, "No notes yet", "Todavía no hay notas")}</h3><p>{search ? tr(language, "Try another search.", "Prueba otra búsqueda.") : tr(language, "Add project facts, decisions or reminders here.", "Agrega aquí datos, decisiones o recordatorios del proyecto.")}</p></div> : <div className="notes-grid">{visible.map((note) => <article className="notes-card card" key={note.id}>
      <div className="notes-card-head"><h3>{note.title}</h3><small>{note.updatedAt ? new Intl.DateTimeFormat(language === "es" ? "es-CR" : "en-US", { dateStyle: "medium" }).format(new Date(note.updatedAt)) : ""}</small></div>
      <p className="notes-content">{note.content}</p>
      <div className="notes-card-footer"><label className="notes-ai-choice"><input type="checkbox" checked={note.aiEnabled} disabled={!canEdit || busy} onChange={(event) => void toggleAi(note, event.target.checked)} /><span>{tr(language, "AI may consult this note", "La IA puede consultar esta nota")}</span></label>{canEdit && <div className="notes-actions"><button className="secondary-button" disabled={busy} onClick={() => openEdit(note)}>{tr(language, "Edit", "Editar")}</button><button className="secondary-button" disabled={busy} onClick={() => void remove(note)}>{tr(language, "Delete", "Eliminar")}</button></div>}</div>
    </article>)}</div>}
  </section>;
}
