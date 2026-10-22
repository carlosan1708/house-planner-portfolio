"use client";

import Image from "next/image";
import { useId, useState } from "react";
import type { ExpenseDocumentRecord } from "@/lib/expense-records";
import "./expense-receipt-picker.css";

export default function ExpenseReceiptPicker({ documents, selectedIds, onToggle, language, busy = false, uses = new Map() }: {
  documents: ExpenseDocumentRecord[]; selectedIds: string[]; onToggle: (id: string) => void;
  language: "en" | "es"; busy?: boolean; uses?: Map<string, number>;
}) {
  const es = language === "es";
  const heading = useId();
  const [query, setQuery] = useState("");
  const matching = documents.filter((item) => `${item.title} ${item.reference} ${item.files.map((file) => file.name).join(" ")}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return <section className="expense-receipt-picker" aria-labelledby={heading}>
    <div className="expense-receipt-picker-heading"><h3 id={heading}>{es ? "Comprobantes existentes" : "Existing receipts"}</h3><span role="status">{selectedIds.length} {es ? (selectedIds.length === 1 ? "seleccionado" : "seleccionados") : "selected"}</span></div>
    <p>{es ? "El mismo comprobante puede respaldar varios pagos. Elegirlo no crea otro gasto." : "The same receipt can support several payments. Selecting it does not create another expense."}</p>
    <input type="search" aria-label={es ? "Buscar comprobantes" : "Search receipts"} value={query} disabled={busy} placeholder={es ? "Buscar por nombre o referencia…" : "Search name or reference…"} onChange={(event) => setQuery(event.target.value)} />
    {matching.length ? <ul className="expense-receipt-picker-grid">{matching.map((item) => {
      const selected = selectedIds.includes(item.id), file = item.files[0], count = uses.get(item.id) || 0;
      return <li key={item.id}><button type="button" aria-label={item.title} aria-pressed={selected} disabled={busy} className={selected ? "selected" : ""} onClick={() => onToggle(item.id)}>
        <span className="expense-receipt-picker-thumbnail" aria-hidden="true">{file?.isImage ? <Image unoptimized src={file.thumbnailUrl || file.previewUrl} width={240} height={160} alt="" /> : <span>{file?.contentType === "application/pdf" ? "PDF" : es ? "ARCHIVO" : "FILE"}</span>}<i>{selected ? "✓" : "+"}</i></span>
        <b>{item.title}</b><small>{count ? (es ? `En ${count} ${count === 1 ? "pago" : "pagos"} · reutilizable` : `In ${count} ${count === 1 ? "payment" : "payments"} · reusable`) : (es ? "Pendiente de vincular" : "Pending link")}</small>
      </button></li>;
    })}</ul> : <p>{query ? (es ? "No hay comprobantes con ese nombre." : "No receipts match that name.") : (es ? "Aún no hay comprobantes. Podés subirlos aquí o desde la biblioteca." : "No receipts yet. Upload them here or from the library.")}</p>}
  </section>;
}
