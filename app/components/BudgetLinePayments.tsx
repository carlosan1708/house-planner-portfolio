"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { readJsonResponse } from "@/lib/api-client";
import type { ExpensePaymentRecord } from "@/lib/expense-records";
import { projectCurrency, type ProjectCurrency } from "@/lib/currency";
import { paymentRecordKind, paymentRecordTitle } from "./payment-record-display";
import "./budget-line-payments.css";

type Language = "en" | "es";
type PaymentSnapshot = { key: string; payments: ExpensePaymentRecord[]; error: string; paymentsModelVersion?: number };

/** One lazy payment request is shared by every budget item in the workspace. */
export function useBudgetPayments({ enabled, projectId, revision }: { enabled: boolean; projectId?: string; revision: number }) {
  const [requested, setRequested] = useState(false);
  const [retryRevision, setRetryRevision] = useState(0);
  const [snapshot, setSnapshot] = useState<PaymentSnapshot | null>(null);
  const requestKey = JSON.stringify([projectId || "", revision, retryRevision]);

  useEffect(() => {
    if (!enabled || !requested) return;
    const controller = new AbortController();
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/expenses/payments", { cache: "no-store", signal: controller.signal });
        const payload = await readJsonResponse<{ payments: ExpensePaymentRecord[]; paymentsModelVersion?: number }>(response);
        if (!Array.isArray(payload.payments)) throw new Error("Invalid payment response");
        if (!cancelled) setSnapshot({ key: requestKey, payments: payload.payments, paymentsModelVersion: payload.paymentsModelVersion, error: "" });
      } catch (reason) {
        if (!cancelled) setSnapshot({ key: requestKey, payments: [], error: reason instanceof Error ? reason.message : "Payment history unavailable" });
      }
    })();
    return () => { cancelled = true; controller.abort(); };
  }, [enabled, requested, requestKey]);

  const load = useCallback(() => { if (enabled) setRequested(true); }, [enabled]);
  const retry = useCallback(() => {
    if (!enabled) return;
    setRequested(true); setRetryRevision((value) => value + 1);
  }, [enabled]);
  const current = enabled && snapshot?.key === requestKey ? snapshot : null;
  return {
    payments: current?.payments || [],
    loading: enabled && requested && !current,
    error: current?.error || "",
    paymentsModelVersion: current?.paymentsModelVersion,
    load,
    retry,
  };
}

const text = (language: Language, en: string, es: string) => language === "es" ? es : en;
const money = (amount: number, language: Language, currency: ProjectCurrency) => new Intl.NumberFormat(language === "es" ? "es-CR" : "en-US", { style: "currency", currency, maximumFractionDigits: Number.isInteger(amount) ? 0 : 2 }).format(amount);
const roundMoney = (amount: number) => Math.round(amount * 100) / 100;

export default function BudgetLinePayments({ line, language, data, onSelectPayment, onRegisterPayment, showLabel = false, paymentsModelVersion, currency = "CRC" }: {
  line: { id: string; item: string; paid: number; workbookPaid?: number };
  language: Language;
  currency?: ProjectCurrency;
  data: ReturnType<typeof useBudgetPayments>;
  onSelectPayment: (payment: ExpensePaymentRecord) => void;
  onRegisterPayment?: () => void;
  showLabel?: boolean;
  paymentsModelVersion?: number;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 16, top: 16, maxHeight: 600 });
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  const restoreFocus = useRef(true);
  const panelId = useId();
  const labelId = `${panelId}-label`;
  const unifiedPayments = paymentsModelVersion === 2 || data.paymentsModelVersion === 2;
  const payments = data.payments.filter((payment) => payment.budgetLineId === line.id)
    .sort((left, right) => right.paymentDate.localeCompare(left.paymentDate) || right.createdAt.localeCompare(left.createdAt) || left.id.localeCompare(right.id));
  const ledgerTotal = payments.filter((payment) => payment.accountingMode === "ledger").reduce((sum, payment) => sum + payment.amount, 0);
  const historicalDetail = payments.filter((payment) => payment.accountingMode !== "ledger").reduce((sum, payment) => sum + payment.amount, 0);
  const workbookPaid = line.workbookPaid ?? Math.max(0, roundMoney(line.paid - ledgerTotal));
  const historicalWithoutDetail = Math.max(0, roundMoney(workbookPaid - historicalDetail));

  const close = useCallback(() => { setOpen(false); }, []);
  const updatePosition = useCallback(() => {
    const rect = trigger.current?.getBoundingClientRect();
    if (!rect) return;
    const margin = 16;
    const width = Math.min(500, window.innerWidth - margin * 2);
    const maxHeight = Math.max(160, window.innerHeight - margin * 2);
    const height = Math.min(panel.current?.getBoundingClientRect().height || 360, maxHeight);
    const below = window.innerHeight - rect.bottom - margin - 8;
    const top = below >= Math.min(height, 280) ? Math.min(rect.bottom + 8, window.innerHeight - height - margin) : Math.max(margin, rect.top - height - 8);
    setPosition({ left: Math.max(margin, Math.min(rect.right - width, window.innerWidth - width - margin)), top: Math.max(margin, top), maxHeight });
  }, []);

  useLayoutEffect(() => {
    if (open) updatePosition();
  }, [open, payments.length, data.loading, data.error, updatePosition]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    const previousTrigger = trigger.current;
    document.body.style.overflow = "hidden";
    panel.current?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
    const anotherOpened = (event: Event) => { if ((event as CustomEvent<string>).detail !== panelId) close(); };
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("budget-payment-history-open", anotherOpened);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("budget-payment-history-open", anotherOpened);
      if (restoreFocus.current && previousTrigger?.isConnected) previousTrigger.focus({ preventScroll: true });
    };
  }, [open, panelId, close, updatePosition]);

  const handoff = (action: () => void) => {
    // The next dialog restores focus to the budget cell, not this temporary panel.
    restoreFocus.current = false;
    trigger.current?.focus({ preventScroll: true });
    close();
    action();
  };

  return <div className="budget-line-payments">
    <button ref={trigger} type="button" className="budget-payment-trigger" aria-label={text(language, `View payments for ${line.item}`, `Ver pagos de ${line.item}`)} aria-expanded={open} aria-controls={open ? panelId : undefined} aria-haspopup="dialog" onClick={() => {
      if (open) { close(); return; }
      restoreFocus.current = true;
      window.dispatchEvent(new CustomEvent("budget-payment-history-open", { detail: panelId }));
      data.load();
      setOpen(true);
    }}>
      {showLabel && <span className="budget-payment-trigger-label">{text(language, "Paid", "Pagado")}</span>}
      <strong><output aria-label={text(language, `${line.item} Paid`, `${line.item} Pagado`)}>{money(line.paid, language, currency)}</output></strong>
      <span className="budget-payment-trigger-action">{text(language, "View payments", "Ver pagos")}<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg></span>
    </button>
    {open && createPortal(<div className="budget-payment-popover-layer" onMouseDown={(event) => { if (event.target === event.currentTarget) { event.preventDefault(); close(); } }}>
      <section ref={panel} id={panelId} role="dialog" aria-modal="true" aria-labelledby={labelId} className="budget-payment-popover" tabIndex={-1}
        style={{ "--budget-payments-left": `${position.left}px`, "--budget-payments-top": `${position.top}px`, "--budget-payments-max-height": `${position.maxHeight}px` } as CSSProperties}
        onKeyDown={(event) => {
          if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); return; }
          if (event.key !== "Tab") return;
          const controls = [...panel.current!.querySelectorAll<HTMLElement>("button:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])")].filter((element) => element.getClientRects().length > 0);
          const first = controls[0], last = controls.at(-1);
          if (!first || !last) { event.preventDefault(); panel.current?.focus(); }
          else if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last.focus(); }
          else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel.current)) { event.preventDefault(); first.focus(); }
          event.stopPropagation();
        }}>
        <header className="budget-payment-popover-header">
          <div><h3 id={labelId}>{text(language, "Payments", "Pagos")}<span className="budget-payment-panel-sr"> {text(language, "for", "de")} {line.item}</span></h3><p>{line.item}</p></div>
          <button type="button" className="budget-payment-popover-close" aria-label={text(language, "Close payments", "Cerrar pagos")} onClick={close}><svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg></button>
        </header>
        <div className="budget-payment-history">
          <p className="budget-payment-canonical"><span>{text(language, "Paid in budget", "Pagado en presupuesto")}</span><strong>{money(line.paid, language, currency)}</strong></p>
          {data.loading ? <p role="status" className="budget-payment-history-status">{text(language, "Loading payments…", "Cargando pagos…")}</p> : data.error ? <div className="budget-payment-history-error"><p role="alert">{text(language, "Payments could not be loaded.", "No se pudieron cargar los pagos.")}</p><button type="button" aria-label={text(language, `Retry payments for ${line.item}`, `Reintentar pagos de ${line.item}`)} onClick={data.retry}>{text(language, "Retry", "Reintentar")}</button></div> : <>
            {payments.length ? <table className="budget-payments-table" aria-label={text(language, `Payments for ${line.item}`, `Pagos de ${line.item}`)}>
              <thead><tr>{[text(language, "Date", "Fecha"), text(language, "Description", "Concepto"), text(language, "Amount", "Monto")].map((heading) => <th scope="col" key={heading}>{heading}</th>)}</tr></thead>
              <tbody>{payments.map((payment) => {
                const title = paymentRecordTitle(payment, language);
                const receipts = payment.documents?.length ? payment.documents.map((document) => document.title) : payment.documentTitle ? [payment.documentTitle] : [];
                const receiptCount = Math.max(payment.documentIds?.length || 0, payment.documentId ? 1 : 0, receipts.length);
                return <tr key={payment.id}>
                  <td className="budget-payment-date"><time dateTime={payment.paymentDate || undefined}>{payment.paymentDate || text(language, "No date", "Sin fecha")}</time></td>
                  <td className="budget-payment-concept"><button type="button" className="budget-payment-concept-link" aria-label={text(language, `View payment ${title}`, `Ver pago ${title}`)} onClick={() => handoff(() => onSelectPayment(payment))}>{title}<span aria-hidden="true">›</span></button><small>{!unifiedPayments && payment.accountingMode !== "ledger" ? text(language, "Excel history · already included", "Histórico de Excel · ya incluido") : paymentRecordKind(payment, language)}</small>{payment.reference && payment.reference !== title && <small>{payment.reference}</small>}
                    {(receiptCount > 0 || payment.purchaseId) && <div className="budget-payment-related-links">
                      {receiptCount > 0 && <button type="button" aria-label={text(language, `View receipts for ${title}`, `Ver comprobantes de ${title}`)} title={receipts.join(" · ")} onClick={() => handoff(() => onSelectPayment(payment))}><svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M4 2h6l2 2v10H4zM6 6h4M6 9h4" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" /></svg>{text(language, `${receiptCount} receipt${receiptCount === 1 ? "" : "s"}`, `${receiptCount} comprobante${receiptCount === 1 ? "" : "s"}`)}</button>}
                      {payment.purchaseId && <button type="button" className="budget-payment-purchase-link" aria-label={text(language, `View purchase ${payment.purchaseTitle || title}`, `Ver compra ${payment.purchaseTitle || title}`)} title={payment.purchaseTitle} onClick={() => handoff(() => onSelectPayment(payment))}>{payment.purchaseTitle || text(language, "Purchase", "Compra")}<span aria-hidden="true">›</span></button>}
                    </div>}
                  </td>
                  <td className="budget-payment-amount">{money(payment.amount, language, projectCurrency(payment.currency))}</td>
                </tr>;
              })}</tbody>
            </table> : <p className="budget-payment-history-status">{text(language, "No payments have been recorded for this item yet.", "Todavía no hay pagos registrados para esta partida.")}</p>}
            {!unifiedPayments && historicalWithoutDetail > 0 && <p className="budget-payment-historical-note"><b>{text(language, "Excel history without a payment breakdown", "Histórico de Excel sin desglose de pagos")}: {money(historicalWithoutDetail, language, currency)}.</b> {text(language, "Already included in the total.", "Ya está incluido en el total.")}</p>}
          </>}
        </div>
        {onRegisterPayment && <footer className="budget-payment-popover-footer"><button type="button" onClick={() => handoff(onRegisterPayment)}><span aria-hidden="true">＋</span>{text(language, "Add payment", "Agregar pago")}</button></footer>}
      </section>
    </div>, document.body)}
  </div>;
}
