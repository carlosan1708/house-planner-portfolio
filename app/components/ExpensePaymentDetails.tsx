"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { readJsonResponse } from "@/lib/api-client";
import { projectCurrency } from "@/lib/currency";
import type { ExpenseDocumentRecord, ExpenseMedia, ExpensePaymentRecord, PurchaseRecord } from "@/lib/expense-records";
import { ExpenseDialog, MediaPreview } from "./ExpensesWorkspace";
import { paymentRecordKind, paymentRecordTitle } from "./payment-record-display";
import "./expense-payment-details.css";

type Language = "en" | "es";
type RelatedRecords<T> = { status: "loading" | "ready" | "error"; records: T[] };
const money = (value: number, currency: "CRC" | "USD", language: Language) => new Intl.NumberFormat(language === "es" ? "es-CR" : "en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(value);

type PaymentDetailsProps = { payment: ExpensePaymentRecord; language: Language; onClose: () => void; onEdit?: () => void; paymentsModelVersion?: number };

export default function ExpensePaymentDetails(props: PaymentDetailsProps) {
  // A different selection gets its own state and cancels the previous reads.
  return <PaymentDetails key={props.payment.id} {...props} />;
}

function PaymentDetails({ payment, language, onClose, onEdit, paymentsModelVersion }: PaymentDetailsProps) {
  const es = language === "es";
  const [documents, setDocuments] = useState<RelatedRecords<ExpenseDocumentRecord>>({ status: "loading", records: [] });
  const [purchases, setPurchases] = useState<RelatedRecords<PurchaseRecord>>({ status: "loading", records: [] });
  const [retry, setRetry] = useState(0);
  const [preview, setPreview] = useState<ExpenseMedia | null>(null);
  const mediaButtons = useRef(new Map<string, HTMLButtonElement>());
  const previewOrigin = useRef<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    void fetch("/api/expenses/documents", { cache: "no-store", signal: controller.signal })
      .then((response) => readJsonResponse<{ documents: ExpenseDocumentRecord[] }>(response))
      .then((data) => {
        if (!Array.isArray(data.documents)) throw new Error("Invalid document list");
        if (active) setDocuments({ status: "ready", records: data.documents });
      }).catch(() => { if (active) setDocuments({ status: "error", records: [] }); });
    void fetch("/api/expenses/purchases", { cache: "no-store", signal: controller.signal })
      .then((response) => readJsonResponse<{ purchases: PurchaseRecord[] }>(response))
      .then((data) => {
        if (!Array.isArray(data.purchases)) throw new Error("Invalid purchase list");
        if (active) setPurchases({ status: "ready", records: data.purchases });
      }).catch(() => { if (active) setPurchases({ status: "error", records: [] }); });
    return () => { active = false; controller.abort(); };
  }, [retry]);

  useEffect(() => {
    if (!preview && previewOrigin.current) {
      mediaButtons.current.get(previewOrigin.current)?.focus({ preventScroll: true });
      previewOrigin.current = null;
    }
  }, [preview]);

  const documentIds = [...new Set(payment.documentIds?.length ? payment.documentIds : payment.documentId ? [payment.documentId] : [])];
  const purchase = purchases.records.find((item) => item.id === payment.purchaseId);
  const documentNames = new Map((payment.documents || []).map((item) => [item.id, item.title]));
  if (payment.documentId && payment.documentTitle && !documentNames.has(payment.documentId)) documentNames.set(payment.documentId, payment.documentTitle);
  const retryReads = () => {
    setDocuments({ status: "loading", records: [] }); setPurchases({ status: "loading", records: [] });
    setRetry((value) => value + 1);
  };
  const openMedia = (media: ExpenseMedia, origin: string) => { previewOrigin.current = origin; setPreview(media); };
  const mediaButtonRef = (id: string, element: HTMLButtonElement | null) => {
    if (element) mediaButtons.current.set(id, element); else mediaButtons.current.delete(id);
  };

  // Only one modal is mounted, so preview and detail never compete for focus.
  if (preview) return <MediaPreview media={preview} language={language} close={() => setPreview(null)} />;

  return <ExpenseDialog className="detail-backdrop expense-form-backdrop" label={es ? "Detalle del pago" : "Payment details"} onClose={onClose} closeOnBackdrop>
    <section className="expense-form expense-payment-details">
      <button type="button" className="close" aria-label={es ? "Cerrar detalle del pago" : "Close payment details"} onClick={onClose}>×</button>
      <div className="payment-details-body">
      <header className="payment-details-header">
        <span className="overline">{es ? "PAGO" : "PAYMENT"}</span>
        <h2>{paymentRecordTitle(payment, language, es ? "Detalle del pago" : "Payment details")}</h2>
        <strong>{money(payment.amount, projectCurrency(payment.currency), language)}</strong>
        <span className="payment-details-kind">{paymentRecordKind(payment, language)}</span>
        {paymentsModelVersion !== 2 && <p>{payment.accountingMode === "ledger" ? (es ? "Pago nuevo · incluido en el acumulado" : "New payment · included in the paid total") : (es ? "Detalle del histórico de Excel · no se suma otra vez" : "Excel history detail · not added again")}</p>}
      </header>
      <dl className="payment-details-facts">
        <div><dt>{es ? "Fecha del pago" : "Payment date"}</dt><dd>{payment.paymentDate || (es ? "Sin fecha" : "No date")}</dd></div>
        <div><dt>{es ? "Partida" : "Budget item"}</dt><dd>{payment.budgetLineLabel || (es ? "Sin partida asignada" : "Unassigned")}</dd></div>
        <div><dt>{es ? "Pagado a" : "Paid to"}</dt><dd>{payment.payee || "—"}</dd></div>
        <div><dt>{es ? "Referencia" : "Reference"}</dt><dd>{payment.reference || "—"}</dd></div>
      </dl>
      {payment.notes && <div className="payment-details-note"><b>{es ? "Notas del pago" : "Payment notes"}</b><p>{payment.notes}</p></div>}

      <section className="payment-details-related" aria-label={es ? "Compra de este pago" : "Purchase for this payment"}>
        <h3>{es ? "Compra asociada" : "Related purchase"}</h3>
        {!payment.purchaseId ? <p className="payment-details-muted">{es ? "Este pago no tiene una compra asociada." : "This payment has no related purchase."}</p> : purchases.status === "loading" ? <p role="status">{es ? "Cargando compra…" : "Loading purchase…"}</p> : purchases.status === "error" ? <><p><b>{payment.purchaseTitle || (es ? "Compra asociada" : "Related purchase")}</b></p><p role="alert">{es ? "No se pudo cargar la compra de este pago." : "The purchase for this payment could not be loaded."}</p></> : !purchase ? <><p><b>{payment.purchaseTitle || (es ? "Compra asociada" : "Related purchase")}</b></p><p className="payment-details-muted">{es ? "Esta compra ya no está disponible. El pago se conserva." : "This purchase is no longer available. The payment is retained."}</p></> : <article className="payment-details-purchase">
          <div className="payment-details-purchase-heading"><h4>{purchase.title || (es ? "Compra sin descripción" : "Untitled purchase")}</h4><strong>{purchase.amount === null ? (es ? "Total sin confirmar" : "Total not confirmed") : money(purchase.amount, purchase.currency, language)}</strong></div>
          <dl className="payment-details-facts">
            <div><dt>{es ? "Proveedor" : "Vendor"}</dt><dd>{purchase.vendor || "—"}</dd></div>
            <div><dt>{es ? "Fecha de compra" : "Purchase date"}</dt><dd>{purchase.purchaseDate || "—"}</dd></div>
            <div><dt>{es ? "Referencia de compra" : "Purchase reference"}</dt><dd>{purchase.reference || "—"}</dd></div>
            <div><dt>{es ? "Partida de la compra" : "Purchase budget item"}</dt><dd>{purchase.outsideObjective ? (es ? "Fuera de objetivo" : "Outside objective") : purchase.budgetLineLabel || (es ? "Sin partida asignada" : "Unassigned")}</dd></div>
          </dl>
          {purchase.notes && <p className="payment-details-note">{purchase.notes}</p>}
          {purchase.photos.length > 0 && <div className="payment-details-photos">{purchase.photos.map((photo) => {
            const origin = `purchase:${photo.id}`;
            return <div key={photo.id}><button type="button" ref={(element) => mediaButtonRef(origin, element)} aria-label={`${es ? "Ver foto de compra" : "View purchase photo"} ${purchase.title}: ${photo.name}`} onClick={() => openMedia(photo, origin)}><Image unoptimized src={photo.thumbnailUrl || photo.previewUrl} width={240} height={180} alt={photo.name} /></button><a href={photo.previewUrl} download={photo.name}>{es ? "Descargar" : "Download"} {photo.name}</a></div>;
          })}</div>}
        </article>}
      </section>

      <section className="payment-details-related" aria-label={es ? "Comprobantes de este pago" : "Receipts for this payment"}>
        <h3>{es ? "Comprobantes del pago" : "Payment receipts"} <small>({documentIds.length})</small></h3>
        {!documentIds.length ? <p className="payment-details-muted">{es ? "No hay comprobantes asociados a este pago." : "No receipts are linked to this payment."}</p> : <>
          {documents.status === "loading" && <p role="status">{es ? "Cargando comprobantes…" : "Loading receipts…"}</p>}
          {documents.status === "error" && <p role="alert">{es ? "No se pudieron cargar los comprobantes de este pago." : "The receipts for this payment could not be loaded."}</p>}
          <ul className="payment-details-receipts">{documentIds.map((id) => {
            const document = documents.records.find((item) => item.id === id);
            const title = document?.title || documentNames.get(id) || (es ? "Comprobante" : "Receipt");
            return <li key={id}><h4>{title}</h4>{documents.status === "ready" && !document ? <p className="payment-details-muted">{es ? "Este comprobante ya no está disponible." : "This receipt is no longer available."}</p> : document && <>
              {[document.documentDate, document.vendor, document.reference].filter(Boolean).length > 0 && <p className="payment-details-muted">{[document.documentDate, document.vendor, document.reference].filter(Boolean).join(" · ")}</p>}
              {document.notes && <p className="payment-details-note">{document.notes}</p>}
              {!document.files.length && <p className="payment-details-muted">{es ? "Este comprobante no tiene archivos disponibles." : "This receipt has no available files."}</p>}
              {document.files.map((file, index) => {
                const origin = `receipt:${id}:${file.id}`;
                return <div className="payment-details-receipt-file" key={file.id}>
                  <button type="button" ref={(element) => mediaButtonRef(origin, element)} aria-label={`${es ? "Ver comprobante" : "View receipt"} ${title}${index ? `: ${file.name}` : ""}`} onClick={() => openMedia(file, origin)}>
                    {file.isImage ? <Image unoptimized src={file.thumbnailUrl || file.previewUrl} width={160} height={120} alt="" /> : <span className="payment-details-file-kind">{file.contentType === "application/pdf" ? "PDF" : (es ? "ARCHIVO" : "FILE")}</span>}
                    <span>{file.name}<small>{es ? "Ver comprobante" : "View receipt"}</small></span>
                  </button>
                  <a href={file.previewUrl} download={file.name}>{es ? "Descargar" : "Download"} {file.name}</a>
                </div>;
              })}
            </>}</li>;
          })}</ul>
        </>}
      </section>
      {(documents.status === "error" || purchases.status === "error") && <button type="button" className="expense-edit payment-details-retry" onClick={retryReads}>{es ? "Reintentar" : "Retry"}</button>}
      </div>
      <footer><button type="button" className="expense-edit" onClick={onClose}>{es ? "Cerrar" : "Close"}</button>{onEdit && <button type="button" className="expense-primary" onClick={onEdit}>{es ? "Editar pago" : "Edit payment"}</button>}</footer>
    </section>
  </ExpenseDialog>;
}
