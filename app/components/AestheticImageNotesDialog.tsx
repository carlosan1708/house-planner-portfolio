"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { MAX_AESTHETIC_NOTES_LENGTH } from "@/lib/aesthetics";

type Props = {
  image: { name: string; notes?: string; thumbnailUrl: string };
  language: "en" | "es";
  canEdit: boolean;
  lockScroll?: boolean;
  formatDemoNotes?: (value: string) => string;
  onSave: (notes: string) => Promise<void>;
  onClose: () => void;
};

export default function AestheticImageNotesDialog({ image, language, canEdit, lockScroll = true, formatDemoNotes, onSave, onClose }: Props) {
  const [draft, setDraft] = useState(image.notes || "");
  const [edited, setEdited] = useState(false);
  const visibleDraft = formatDemoNotes && !edited ? formatDemoNotes(draft) : draft;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const dialog = useRef<HTMLFormElement>(null);
  const dirty = visibleDraft !== (image.notes || "");
  const t = (en: string, es: string) => language === "es" ? es : en;

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.current?.querySelector<HTMLElement>("textarea, button")?.focus({ preventScroll: true });
    return () => {
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    // An enclosing viewer already owns this lock; nested notes must not snapshot it.
    if (!lockScroll) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, [lockScroll]);

  useEffect(() => {
    if (!dirty && !saving) return;
    const protectDraft = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", protectDraft);
    return () => window.removeEventListener("beforeunload", protectDraft);
  }, [dirty, saving]);

  useEffect(() => {
    if (saving) dialog.current?.focus();
  }, [saving]);

  const save = async () => {
    if (!canEdit || saving || !dirty) return;
    setSaving(true);
    setError("");
    try {
      await onSave(visibleDraft);
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("Notes could not be saved", "No se pudieron guardar las notas"));
      setSaving(false);
    }
  };

  return <div className="detail-backdrop aesthetic-dialog-backdrop aesthetic-notes-backdrop" role="presentation"
    onMouseDown={(event) => { if (!saving && !dirty && event.target === event.currentTarget) onClose(); }}
    onKeyDown={(event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (!saving && !dirty) onClose();
      }
      if (event.key !== "Tab") return;
      const controls = Array.from(dialog.current?.querySelectorAll<HTMLElement>("textarea:not([disabled]), button:not([disabled])") || []);
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }}>
    <form ref={dialog} tabIndex={-1} className="aesthetic-dialog aesthetic-notes-dialog" role="dialog" aria-modal="true" aria-labelledby="aesthetic-notes-title" aria-describedby="aesthetic-notes-image" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <header className="aesthetic-notes-heading">
        <Image unoptimized width={64} height={64} src={image.thumbnailUrl} alt="" />
        <div><h3 id="aesthetic-notes-title">{t("Image notes", "Notas de la imagen")}</h3><p id="aesthetic-notes-image">{image.name}</p></div>
      </header>
      {canEdit ? <>
        <label htmlFor="aesthetic-notes-text">{t("Notes", "Notas")}</label>
        <textarea id="aesthetic-notes-text" disabled={saving} maxLength={MAX_AESTHETIC_NOTES_LENGTH} rows={8} value={visibleDraft} onChange={(event) => { setEdited(true); setDraft(event.target.value); }} placeholder={t("Colors, materials or details to remember…", "Colores, materiales o detalles para recordar…")} />
        <small className="aesthetic-notes-length">{visibleDraft.length} / {MAX_AESTHETIC_NOTES_LENGTH}</small>
      </> : <p className={`aesthetic-notes-content ${image.notes?.trim() ? "" : "empty"}`}>{image.notes?.trim() ? image.notes : t("No notes for this image yet.", "Esta imagen todavía no tiene notas.")}</p>}
      {error && <div className="form-error" role="alert">{error}</div>}
      <div className="aesthetic-dialog-actions">
        <button type="button" disabled={saving} onClick={onClose}>{canEdit ? t("Cancel", "Cancelar") : t("Close", "Cerrar")}</button>
        {canEdit && <button className="primary-button" type="submit" disabled={saving || !dirty}>{saving ? t("Saving…", "Guardando…") : t("Save notes", "Guardar notas")}</button>}
      </div>
    </form>
  </div>;
}
