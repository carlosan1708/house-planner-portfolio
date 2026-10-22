"use client";
import { useState } from "react";
import type { DistributionRecord } from "@/lib/house-distribution";
import type { DistributionExportScene } from "@/lib/distribution-export-images";

export default function DistributionExport({ language, disabled, prepareScene }: { language: "en" | "es"; disabled: boolean; prepareScene: (record: DistributionRecord) => Promise<DistributionExportScene | undefined> }) {
  const es = language === "es";
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [done, setDone] = useState(0);
  async function download() {
    setBusy(true); setError(""); setDone(0);
    try {
      // Recheck current project/source permissions and export the latest saved corrections.
      const response = await fetch("/api/house-distribution", { cache: "no-store" });
      if (!response.ok) throw new Error(es ? "No se pudo acceder al modelo. Recarga la página y verifica tu acceso." : "Model access failed. Reload the page and check your access.");
      const data = await response.json() as { record: DistributionRecord | null };
      if (!data.record) throw new Error(es ? "No hay un modelo disponible para exportar." : "No model is available to export.");
      const { buildDistributionExportZip } = await import("@/lib/distribution-export");
      const { createDistributionExportImages } = await import("@/lib/distribution-export-images");
      const images = await createDistributionExportImages(data.record, await prepareScene(data.record));
      const { bytes, filename } = await buildDistributionExportZip(data.record, images);
      const blob = new Blob([new Uint8Array(bytes)], { type: "application/zip" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a"); link.href = url; link.download = filename;
      document.body.append(link);
      try { link.click(); } finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 30_000); }
      setDone(images.length);
    } catch {
      setError(es ? "No se pudo exportar. Recarga la página y verifica que aún tengas acceso al modelo y sus planos." : "Export failed. Reload the page and check that you still have access to the model and its blueprints.");
    } finally { setBusy(false); }
  }
  return <div className="distribution-export">
    <button type="button" disabled={busy || disabled} onClick={() => void download()} aria-describedby="distribution-export-description">{busy ? (es ? "Preparando ZIP…" : "Preparing ZIP…") : (es ? "Exportar para Codex" : "Export for Codex")}</button>
    <p id="distribution-export-description">{es ? "ZIP con geometría editable, todas las medidas, planta PNG y captura de la vista 3D disponible. Incluye correcciones guardadas y cotas pendientes." : "ZIP with editable geometry, all measurements, a PNG floor plan and a capture of the available 3D view. Includes saved corrections and pending dimensions."}</p>
    {!!done && <p role="status">{es ? "Paquete preparado. Descomprime el ZIP y abre la carpeta en Codex; comienza por LEEME.md." : "Package prepared. Extract the ZIP and open the folder in Codex; start with LEEME.md."}{done === 1 && (es ? " Incluye la planta PNG; la captura 3D no estuvo disponible." : " Includes the PNG floor plan; the 3D capture was unavailable.")}</p>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
