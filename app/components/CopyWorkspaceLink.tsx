"use client";

import { useState } from "react";
import { workspaceShareUrl, type WorkspaceDestination } from "@/lib/workspace-navigation";

type Props = { language: "en" | "es" } & (
  { destination: WorkspaceDestination; href?: never } | { href: string; destination?: never }
);

export default function CopyWorkspaceLink({ destination, href, language }: Props) {
  const [copied, setCopied] = useState(false);
  const [manualUrl, setManualUrl] = useState("");
  const es = language === "es";

  async function copy() {
    const url = href || workspaceShareUrl(window.location.origin, destination!);
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(url);
      setManualUrl("");
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
      setManualUrl(url);
    }
  }

  return <div className="workspace-share">
    <button className="secondary-button" onClick={() => void copy()}>{copied ? (es ? "Enlace copiado" : "Link copied") : (es ? "Copiar enlace" : "Copy link")}</button>
    {copied && <span className="sr-only" role="status">{es ? "Enlace copiado" : "Link copied"}</span>}
    {manualUrl && <div className="workspace-share-fallback" role="dialog" aria-label={es ? "Copiar enlace manualmente" : "Copy link manually"}>
      <label>{es ? "Selecciona y copia esta dirección" : "Select and copy this address"}<input aria-label={es ? "Dirección para compartir" : "Share address"} value={manualUrl} readOnly onFocus={event => event.currentTarget.select()} autoFocus /></label>
      <button className="secondary-button" onClick={() => setManualUrl("")}>{es ? "Cerrar" : "Close"}</button>
    </div>}
  </div>;
}
