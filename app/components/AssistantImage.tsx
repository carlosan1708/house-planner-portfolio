"use client";

import { useState } from "react";
import type { AssistantMessage } from "@/lib/assistant";

type Folder = { id: string; name: string; parentId: string | null; kind: string };

export default function AssistantImage({ image, language }: { image: NonNullable<AssistantMessage["image"]>; language: "en" | "es" }) {
  const t = (en: string, es: string) => language === "es" ? es : en;
  const [folders, setFolders] = useState<Folder[] | null>(null);
  const [folderId, setFolderId] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [failed, setFailed] = useState(false);

  async function loadFolders() {
    setBusy(true);
    setFailed(false);
    try {
      const response = await fetch("/api/aesthetics", { cache: "no-store" });
      if (!response.ok) throw new Error();
      const data = await response.json() as { folders: Folder[] };
      setFolders(data.folders.filter(folder => folder.kind === "images"));
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setBusy(true);
    setFailed(false);
    try {
      const params = new URLSearchParams(image.href.split("?")[1]);
      const response = await fetch("/api/assistant/images", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...Object.fromEntries(params), folderId }) });
      if (!response.ok) throw new Error();
      setSaved(true);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  function path(folder: Folder) {
    const names = [folder.name];
    let parent = folder.parentId;
    while (parent && names.length <= (folders?.length || 0)) {
      const item = folders?.find(candidate => candidate.id === parent);
      if (!item) break;
      names.unshift(item.name);
      parent = item.parentId;
    }
    return names.join(" / ");
  }

  return <section className="assistant-generated-image">
    {/* This authenticated image requires the browser's project session. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src={image.href} alt={t("Conceptual visualization based on the chosen plan", "Visualización conceptual basada en el plano elegido")} loading="lazy" />
    <p>{image.name} · {t("Pages consulted", "Páginas consultadas")} {image.pages.join(", ")} · {image.model}</p>
    {image.references.length !== image.pages.length && <p>{t("Pages sent as visual references", "Páginas enviadas como referencia visual")} {image.references.join(", ")}</p>}
    <a className="assistant-open-draft" href={`${image.href}&download=1`}>{t("Download", "Descargar")}</a>
    {image.canSave && !saved && (folders === null
      ? <button type="button" className="assistant-open-draft" disabled={busy} onClick={() => void loadFolders()}>{t("Save to Aesthetics", "Guardar en Estética")}</button>
      : <form onSubmit={event => { event.preventDefault(); void save(); }}>
        <label>{t("Image folder", "Carpeta de imágenes")} <select value={folderId} onChange={event => setFolderId(event.target.value)} required>
          <option value="">{t("Choose a folder", "Elegí una carpeta")}</option>
          {folders.map(folder => <option key={folder.id} value={folder.id}>{path(folder)}</option>)}
        </select></label>
        <button type="submit" className="assistant-confirm" disabled={!folderId || busy}>{t("Save", "Guardar")}</button>
      </form>)}
    {saved && <p role="status">{t("Saved to Aesthetics", "Guardada en Estética")}</p>}
    {failed && <p role="alert">{t("Could not save the image. Try again.", "No se pudo guardar la imagen. Volvé a intentar.")}</p>}
  </section>;
}
