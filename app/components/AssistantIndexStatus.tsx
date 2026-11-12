"use client";

import { useEffect, useRef, useState } from "react";
import type { RagStatus } from "@/lib/rag-jobs";

const labels = {
  pending: ["Assistant indexing pending", "Pendiente de indexar"],
  indexing: ["Indexing for the assistant", "Indexando para el asistente"],
  ready: ["Ready for the assistant", "Listo para el asistente"],
  empty: ["No readable text for the assistant", "Sin texto legible para el asistente"],
  unsupported: ["Outside the assistant index", "Fuera del índice del asistente"],
  failed: ["Assistant indexing failed", "Falló la indexación para el asistente"],
};

export default function AssistantIndexStatus({ id, kind = "document", index = 0, projectId, language }: {
  id: string; kind?: "document" | "quote"; index?: number; projectId?: string; language: "es" | "en";
}) {
  const label = useRef<HTMLSpanElement>(null);
  const request = useRef<AbortController | null>(null);
  const [data, setData] = useState<{ status: RagStatus; canRetry?: boolean }>();
  const [busy, setBusy] = useState(false);
  const [retryFailed, setRetryFailed] = useState(false);
  const [pollVersion, setPollVersion] = useState(0);
  const query = new URLSearchParams({ id, kind, index: String(index), ...(projectId ? { projectId } : {}) }).toString();

  useEffect(() => {
    const controller = new AbortController();
    request.current = controller;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let visible = typeof IntersectionObserver === "undefined";
    async function load() {
      try {
        const response = await fetch(`/api/assistant/documents?${query}`, { signal: controller.signal });
        if (!response.ok) return;
        const result = await response.json();
        if (Object.hasOwn(labels, result.status)) setData(result);
        if (visible && !controller.signal.aborted && (result.status === "pending" || result.status === "indexing"))
          timer = setTimeout(() => void load(), 15_000);
      } catch {
        if (visible && !controller.signal.aborted) timer = setTimeout(() => void load(), 30_000);
      }
    }
    const observer = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && !visible) {
        visible = true;
        void load();
      } else if (!entry.isIntersecting) {
        visible = false;
        clearTimeout(timer);
      }
    });
    if (observer && label.current) observer.observe(label.current);
    if (visible) void load();
    return () => {
      controller.abort();
      observer?.disconnect();
      clearTimeout(timer);
    };
  }, [query, pollVersion]);

  async function retry() {
    setBusy(true);
    setRetryFailed(false);
    try {
      const response = await fetch("/api/assistant/documents", {
        method: "POST", signal: request.current?.signal, headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, kind, index, projectId, action: "index" }),
      });
      if (!response.ok) throw new Error("retry_failed");
      setData(await response.json());
      setPollVersion((version) => version + 1);
    } catch { setRetryFailed(true); }
    finally { setBusy(false); }
  }

  return <span ref={label} style={{ display: "inline-block", minWidth: 1, minHeight: 1 }}>
    {data && <small>{labels[data.status][language === "es" ? 1 : 0]}{" "}
      {data.canRetry && (data.status === "failed" || data.status === "empty") && <button type="button" disabled={busy} onClick={() => void retry()}>
        {language === "es" ? "Reintentar" : "Retry"}
      </button>}
      {retryFailed && <span role="status">{language === "es" ? "No se pudo reintentar." : "Retry failed."}</span>}
    </small>}
  </span>;
}
