"use client";

import type { UploadProgressState } from "@/lib/upload-progress";
import "./upload-progress.css";

export default function UploadProgress({ progress, language, error = false, fileCount }: { progress: UploadProgressState | null; language: "en" | "es"; error?: boolean; fileCount?: number }) {
  if (!progress) return null;
  const es = language === "es";
  const processing = progress.phase === "processing" && !error;
  const label = error ? es ? "Carga detenida" : "Upload stopped" : processing ? es ? "Procesando archivos…" : "Processing files…" : es ? "Subiendo archivos…" : "Uploading files…";
  const count = progress.fileCount || fileCount || 0;
  const detail = progress.fileIndex && count ? `${es ? "Archivo" : "File"} ${progress.fileIndex} / ${count}` : count > 1 ? `${count} ${es ? "archivos" : "files"}` : "";
  const accepted = progress.completedFiles !== undefined && count > 1 ? `${progress.completedFiles} / ${count} ${es ? "guardados" : "saved"}` : "";
  const value = progress.percent === null ? undefined : progress.percent;
  return <div className={`upload-progress${processing ? " processing" : ""}${error ? " failed" : ""}`} data-phase={error ? "failed" : progress.phase} aria-busy={!error}>
    <div className="upload-progress-heading" role="status" aria-live="polite"><b>{label}</b>{value !== undefined && <span>{value}%</span>}</div>
    <progress aria-label={label} max={100} value={value} />
    {(detail || progress.fileName || accepted) && <small>{[detail, progress.fileName, accepted].filter(Boolean).join(" · ")}</small>}
    {processing && <small>{es ? "La transferencia terminó. Esperando que el servidor guarde los archivos." : "Transfer finished. Waiting for the server to save the files."}</small>}
  </div>;
}
