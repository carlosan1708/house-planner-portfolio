"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import ModalOverlay from "./ModalOverlay";
import "./file-share.css";

type Props = {
  kind: "document" | "aesthetic";
  id: string;
  name: string;
  projectId: string;
  language: "en" | "es";
  canShare: boolean;
  encrypted?: boolean;
  disabled?: boolean;
};
type ShareLink = { url: string; expiresAt: string; expiresInDays: 1 | 3 | 7 };

export default function FileShareButton(props: Props) {
  if (!props.canShare || props.encrypted || !props.projectId) return null;
  // Remount when the context changes, so a prior project's link never appears here.
  return <FileShareControl key={`${props.projectId}:${props.kind}:${props.id}`} {...props} />;
}

function FileShareControl({ kind, id, name, language, disabled }: Props) {
  const es = language === "es";
  const titleId = useId();
  const helpId = useId();
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState<1 | 3 | 7>(7);
  const [link, setLink] = useState<ShareLink | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [manualCopy, setManualCopy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const request = useRef<AbortController | null>(null);
  const generation = useRef(0);

  useEffect(() => () => { generation.current += 1; request.current?.abort(); }, []);

  function reset() {
    generation.current += 1;
    request.current?.abort();
    request.current = null;
    setBusy(false);
    setLink(null);
    setError("");
    setCopied(false);
    setManualCopy(false);
  }

  function close() {
    reset();
    setOpen(false);
  }

  async function generate() {
    reset();
    const current = generation.current;
    const controller = new AbortController();
    request.current = controller;
    // Disabling the focused Generate button can move browser focus to <body>.
    // Keep keyboard cancellation inside the dialog while the request is pending.
    closeButtonRef.current?.focus({ preventScroll: true });
    setBusy(true);
    try {
      const response = await fetch("/api/files/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, id, expiresInDays: days }),
        signal: controller.signal,
      });
      const data = await response.json();
      if (!response.ok) throw new Error("share_unavailable");
      if (typeof data.url !== "string" || !Number.isFinite(Date.parse(data.expiresAt)) || data.expiresInDays !== days) throw new Error("share_unavailable");
      const url = new URL(data.url, window.location.origin);
      if (!["http:", "https:"].includes(url.protocol)) throw new Error("share_unavailable");
      if (generation.current === current) setLink({ ...data, url: url.href });
    } catch {
      if (generation.current === current && !controller.signal.aborted) setError(es ? "No se pudo crear el enlace. Intentá de nuevo." : "The link could not be created. Try again.");
    } finally {
      if (generation.current === current) {
        request.current = null;
        setBusy(false);
      }
    }
  }

  async function copy() {
    if (!link) return;
    const current = generation.current;
    try {
      if (!navigator.clipboard?.writeText) throw new Error("clipboard_unavailable");
      await navigator.clipboard.writeText(link.url);
      if (generation.current !== current) return;
      setCopied(true);
      setManualCopy(false);
    } catch {
      if (generation.current !== current) return;
      setCopied(false);
      setManualCopy(true);
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }

  return <>
    <button type="button" className="file-share-button" disabled={disabled} aria-haspopup="dialog" aria-label={es ? `Compartir ${name}` : `Share ${name}`} onClick={(event) => { event.currentTarget.focus({ preventScroll: true }); setOpen(true); }}>{es ? "Compartir archivo" : "Share file"}</button>
    {open && createPortal(<ModalOverlay className="confirm-modal file-share-modal" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={helpId} onEscape={close} onPointerDown={(event) => event.stopPropagation()} onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
      <section className="confirm-card file-share-card" onMouseDown={(event) => event.stopPropagation()}>
        <h3 id={titleId}>{es ? "Enlace temporal" : "Temporary link"}</h3>
        <p className="file-share-name">{name}</p>
        <p id={helpId}>{es ? "Cualquier persona con este enlace podrá descargar este archivo sin iniciar sesión hasta que venza." : "Anyone with this link can download this file without signing in until it expires."}</p>
        <label className="file-share-field">{es ? "Vigencia del enlace" : "Link duration"}<select value={days} onChange={(event) => { reset(); setDays(Number(event.target.value) as 1 | 3 | 7); }}>{([1, 3, 7] as const).map((value) => <option key={value} value={value}>{es ? `${value} ${value === 1 ? "día" : "días"}` : `${value} ${value === 1 ? "day" : "days"}`}</option>)}</select></label>
        {link && <div className="file-share-result">
          <p className="file-share-expiration">{es ? "Vence:" : "Expires:"} <time dateTime={link.expiresAt}>{new Date(link.expiresAt).toLocaleString(es ? "es-CR" : "en-US", { dateStyle: "full", timeStyle: "long" })}</time></p>
          <label className="file-share-field">{es ? "Enlace para compartir" : "Share link"}<input ref={inputRef} type="text" readOnly value={link.url} onFocus={(event) => event.currentTarget.select()} spellCheck={false} /></label>
          <button type="button" className="secondary-button" onClick={() => void copy()}>{copied ? (es ? "Enlace copiado" : "Link copied") : (es ? "Copiar enlace" : "Copy link")}</button>
          {copied && <span role="status">{es ? "Enlace copiado" : "Link copied"}</span>}
          {manualCopy && <p role="status">{es ? "Seleccioná y copiá el enlace de arriba manualmente." : "Select and copy the link above manually."}</p>}
        </div>}
        {error && <div className="form-error" role="alert">{error}</div>}
        <div className="file-share-actions"><button ref={closeButtonRef} type="button" className="secondary-button" data-modal-initial-focus onClick={close}>{es ? "Cerrar" : "Close"}</button><button type="button" className="primary-button" disabled={busy || disabled} onClick={() => void generate()}>{busy ? (es ? "Creando enlace…" : "Creating link…") : link ? (es ? "Crear otro enlace" : "Create another link") : (es ? "Crear enlace" : "Create link")}</button></div>
        {busy && <span className="sr-only" role="status">{es ? "Creando enlace…" : "Creating link…"}</span>}
      </section>
    </ModalOverlay>, document.body)}
  </>;
}
