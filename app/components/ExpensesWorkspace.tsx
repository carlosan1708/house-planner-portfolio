"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { readJsonResponse, requestJsonWithRetry, requestWithRetry, UnexpectedApiResponseError } from "@/lib/api-client";
import { normalizeCrcAmountInput } from "@/lib/expense-input";
import { projectCurrency } from "@/lib/currency";
import type { ExpenseDocumentRecord, ExpenseMedia, ExpensePaymentRecord, PurchaseRecord } from "@/lib/expense-records";
import { deriveExpensesFromBudgetLines, type ExpenseRecord } from "@/lib/expenses";
import { uploadFormData, type UploadProgressState } from "@/lib/upload-progress";
import { trackDemoAction, trackUsageInteraction } from "@/lib/usage-client";
import type { BudgetLine } from "@/lib/workbook";
import { buildWorkspacePath } from "@/lib/workspace-navigation";
import UploadProgress from "./UploadProgress";
import ExpenseReceiptPicker from "./ExpenseReceiptPicker";
import { isExcelImportedPayment, paymentRecordKind, paymentRecordTitle } from "./payment-record-display";
import "./expenses.css";

type Language = "en" | "es";
type Tab = "purchases" | "documents" | "payments" | "paid";
type PaidStatusFilter = "all" | "needs-detail" | "complete" | "with-files" | "without-files";
type PaidLine = { id: string; label: string; chapter: string; supplier: string; paid: number; workbookPaid?: number };
type PaidPayload = { expenses: ExpenseRecord[]; budgetLines: BudgetLine[]; summary: { total: number }; currency?: "CRC" | "USD" };
type PurchasePayload = { purchases: PurchaseRecord[] };
type DocumentPayload = { documents: ExpenseDocumentRecord[]; purchases: Array<{ id: string; title: string; budgetLineId: string | null }> };
type PaymentPayload = { payments: ExpensePaymentRecord[]; completedLineIds: string[]; paymentsModelVersion?: number };
type PurchaseDraft = { id?: string; title: string; purchaseDate: string; vendor: string; reference: string; notes: string; amount: string; currency: "CRC" | "USD"; budgetLineId: string; coverPhotoId?: string | null };
type DocumentDraft = { id?: string; title: string; documentType: "invoice" | "receipt" | "payroll" | "other"; documentDate: string; vendor: string; reference: string; notes: string; amount: string; currency: "CRC" | "USD"; purchaseId: string; budgetLineIds: string[] };
type PaymentDraft = { expectedCurrency: "USD" | "CRC"; id?: string; budgetLineId: string; purchaseId: string; amount: string; paymentDate: string; payee: string; reference: string; notes: string; documentId: string; documentIds: string[]; paymentKind: "partial" | "settlement"; accountingMode: "ledger" | "historical-detail" | ""; clientMutationId: string };

const tx = (language: Language, en: string, es: string) => language === "es" ? es : en;
const cash = (value: number, currency: "CRC" | "USD", language: Language) => new Intl.NumberFormat(language === "es" ? "es-CR" : "en-US", { style: "currency", currency, maximumFractionDigits: currency === "CRC" && Number.isInteger(value) ? 0 : 2 }).format(value);
const searchKey = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase();
const requestJson = readJsonResponse;
const purchaseBlank = (budgetLineId = "", currency: "CRC" | "USD" = "CRC"): PurchaseDraft => ({ title: "", purchaseDate: "", vendor: "", reference: "", notes: "", amount: "", currency, budgetLineId, coverPhotoId: null });
const documentBlank = (budgetLineId = "", purchaseId = "", currency: "CRC" | "USD" = "CRC"): DocumentDraft => ({ title: "", documentType: "invoice", documentDate: "", vendor: "", reference: "", notes: "", amount: "", currency, purchaseId, budgetLineIds: budgetLineId ? [budgetLineId] : [] });
const documentLineIds = (item: ExpenseDocumentRecord) => item.budgetLineIds?.length ? item.budgetLineIds : item.budgetLineId ? [item.budgetLineId] : [];
const paymentBlank = (budgetLineId = "", expectedCurrency: "USD" | "CRC" = "CRC"): PaymentDraft => ({ expectedCurrency, budgetLineId, purchaseId: "", amount: "", paymentDate: new Date().toISOString().slice(0, 10), payee: "", reference: "", notes: "", documentId: "", documentIds: [], paymentKind: "partial", accountingMode: "ledger", clientMutationId: crypto.randomUUID() });
const paymentDocumentIds = (item: Pick<ExpensePaymentRecord, "documentIds" | "documentId">) => item.documentIds?.length ? item.documentIds : item.documentId ? [item.documentId] : [];
const paymentFromRecord = (item: ExpensePaymentRecord): PaymentDraft => ({ ...paymentBlank(item.budgetLineId || "", projectCurrency(item.currency)), id: item.id, purchaseId: item.purchaseId || "", amount: String(item.amount), paymentDate: item.paymentDate, payee: item.payee, reference: item.reference, notes: item.notes, documentId: item.documentId || "", documentIds: paymentDocumentIds(item), paymentKind: item.paymentKind || "partial", accountingMode: item.accountingMode === "ledger" ? "ledger" : "historical-detail" });
function paymentWriteBody(value: Record<string, unknown>, paymentsModelVersion: number, expectedCurrency: "USD" | "CRC") {
  const body: Record<string, unknown> = { ...value, expectedCurrency };
  if (paymentsModelVersion === 2) { delete body.accountingMode; body.paymentsModelVersion = 2; }
  return body;
}
const roundedMoney = (amount: number) => Math.round(amount * 100) / 100;
function historicalPaymentBase(lines: Array<{ id: string; paid: number; workbookPaid?: number }>, payments: ExpensePaymentRecord[], budgetLineId: string) {
  const line = lines.find((item) => item.id === budgetLineId);
  if (!line) return 0;
  if (typeof line.workbookPaid === "number" && Number.isFinite(line.workbookPaid)) return Math.max(0, roundedMoney(line.workbookPaid));
  const ledger = payments.filter((payment) => payment.budgetLineId === budgetLineId && payment.accountingMode === "ledger").reduce((sum, payment) => sum + payment.amount, 0);
  return Math.max(0, roundedMoney(line.paid - ledger));
}
function availableHistoricalPayment(lines: Array<{ id: string; paid: number; workbookPaid?: number }>, payments: ExpensePaymentRecord[], budgetLineId: string, excludeId?: string) {
  const detailed = payments.filter((payment) => payment.budgetLineId === budgetLineId && payment.id !== excludeId && payment.accountingMode !== "ledger").reduce((sum, payment) => sum + payment.amount, 0);
  return Math.max(0, roundedMoney(historicalPaymentBase(lines, payments, budgetLineId) - detailed));
}
function initialPaymentAccounting(mode: "demo" | "real", budgetLineId: string, lines: Array<{ id: string; paid: number; workbookPaid?: number }>, payments: ExpensePaymentRecord[], paymentsModelVersion = 1): PaymentDraft["accountingMode"] {
  return mode === "real" && paymentsModelVersion !== 2 && historicalPaymentBase(lines, payments, budgetLineId) > 0 ? "" : "ledger";
}
const documentLabels = (language: Language) => ({ invoice: tx(language, "Invoice", "Factura"), receipt: tx(language, "Receipt", "Recibo"), payroll: tx(language, "Payroll", "Planilla"), other: tx(language, "Other", "Otro") });

const demoLine: PaidLine = { id: "demo-line", label: "Muebles de cocina", chapter: "Acabados", supplier: "Proveedor demo", paid: 1250 };
const demoBudgetLine: BudgetLine = { id: demoLine.id, row: 4, chapter: demoLine.chapter, item: demoLine.label, type: "Compra", subcategory: "Cocina", objective: 1800, excess: 0, quote: 1600, paid: demoLine.paid, supplier: demoLine.supplier, status: "En progreso" };
const demoPaid: PaidPayload = { expenses: deriveExpensesFromBudgetLines([demoBudgetLine]), budgetLines: [demoBudgetLine], summary: { total: demoLine.paid } };
const demoPurchase: PurchaseRecord = { id: "demo-purchase", title: "Grifería para cocina", purchaseDate: "2026-09-12", vendor: "Tienda Demo", reference: "OC-104", notes: "Acabado negro mate", amount: 395, currency: "USD", budgetLineId: demoLine.id, budgetLineLabel: demoLine.label, coverPhotoId: null, photos: [], documentCount: 1, createdAt: "2026-09-12T12:00:00Z", updatedAt: "2026-09-12T12:00:00Z" };
const demoDocument: ExpenseDocumentRecord = { id: "demo-document", title: "Factura grifería", documentType: "invoice", documentDate: "2026-09-12", vendor: "Tienda Demo", reference: "F-8201", notes: "", amount: 395, currency: "USD", purchaseId: demoPurchase.id, purchaseTitle: demoPurchase.title, budgetLineIds: [demoLine.id], budgetLines: [{ id: demoLine.id, label: demoLine.label }], budgetLineId: demoLine.id, budgetLineLabel: demoLine.label, files: [], createdAt: "2026-09-12T12:00:00Z", updatedAt: "2026-09-12T12:00:00Z" };
const demoPayment: ExpensePaymentRecord = { id: "demo-payment", currency: "USD", budgetLineId: demoLine.id, budgetLineLabel: demoLine.label, purchaseId: demoPurchase.id, amount: 195, paymentDate: "2026-09-12", payee: "Tienda Demo", reference: "Transferencia 1", notes: "Primer abono", documentId: demoDocument.id, documentTitle: demoDocument.title, documentType: demoDocument.documentType, createdAt: "2026-09-12T12:00:00Z", updatedAt: "2026-09-12T12:00:00Z" };


// Only predefined fields on known demo records are projected; IDs and raw state stay canonical.
const demoExpenseText: Record<string, Record<string, readonly [string, string]>> = {
  "demo-line": { label: ["Kitchen cabinetry", "Muebles de cocina"], item: ["Kitchen cabinetry", "Muebles de cocina"], description: ["Kitchen cabinetry", "Muebles de cocina"], chapter: ["Finishes", "Acabados"], supplier: ["Demo supplier", "Proveedor demo"], vendor: ["Demo supplier", "Proveedor demo"], type: ["Purchase", "Compra"], subcategory: ["Kitchen", "Cocina"], status: ["In progress", "En progreso"] },
  "demo-purchase": { title: ["Kitchen faucet", "Grifería para cocina"], vendor: ["Demo Store", "Tienda Demo"], notes: ["Matte black finish", "Acabado negro mate"], budgetLineLabel: ["Kitchen cabinetry", "Muebles de cocina"] },
  "demo-document": { title: ["Faucet invoice", "Factura grifería"], vendor: ["Demo Store", "Tienda Demo"], purchaseTitle: ["Kitchen faucet", "Grifería para cocina"], budgetLineLabel: ["Kitchen cabinetry", "Muebles de cocina"] },
  "demo-payment": { payee: ["Demo Store", "Tienda Demo"], reference: ["Transfer 1", "Transferencia 1"], notes: ["First installment", "Primer abono"], documentTitle: ["Faucet invoice", "Factura grifería"], budgetLineLabel: ["Kitchen cabinetry", "Muebles de cocina"] },
};
function projectDemoExpense<T extends { id?: string }>(item: T, language: Language, edited: string[] = []): T {
  const fields = demoExpenseText[item.id || ""];
  if (!fields) return item;
  return Object.fromEntries(Object.entries(item).map(([field, value]) => {
    const text = fields[field];
    return [field, text && !edited.includes(field) && (value === text[0] || value === text[1]) ? tx(language, text[0], text[1]) : value];
  })) as T;
}
function changedDraftFields<T extends object>(before: T, after: T) {
  const previous = before as Record<string, unknown>, next = after as Record<string, unknown>;
  return Object.keys(next).filter((field) => next[field] !== previous[field]);
}

export function ExpenseDialog({ className, label, onClose, busy = false, closeOnBackdrop = false, children }: { className: string; label: string; onClose: () => void; busy?: boolean; closeOnBackdrop?: boolean; children: ReactNode }) {
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    if (!dialog.current?.contains(document.activeElement)) {
      const field = [...dialog.current!.querySelectorAll<HTMLElement>("input:not([type=hidden]):not([hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled])")].find((element) => element.getClientRects().length > 0);
      (field || dialog.current?.querySelector<HTMLElement>("button:not([disabled])") || dialog.current)?.focus({ preventScroll: true });
    }
    return () => {
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);
  return <div ref={dialog} className={className} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}
    onMouseDown={(event) => { if (closeOnBackdrop && !busy && event.target === event.currentTarget) onClose(); }}
    onKeyDown={(event) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); if (!busy) onClose(); return; }
      if (event.key !== "Tab") return;
      const controls = Array.from(dialog.current?.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), a[href], iframe, [tabindex]:not([tabindex='-1'])") || []).filter((element) => element.getClientRects().length > 0);
      const first = controls[0], last = controls.at(-1);
      if (!first || !last) { event.preventDefault(); dialog.current?.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog.current)) { event.preventDefault(); first.focus(); }
      event.stopPropagation();
    }}>{children}</div>;
}

export function MediaPreview({ media, language, close }: { media: ExpenseMedia; language: Language; close: () => void }) {
  const [retryKey, setRetryKey] = useState(0);
  const [source, setSource] = useState("");
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    let cancelled = false;
    let objectUrl = "";
    void (async () => {
      try {
        const validResponse = (candidate: Response) => candidate.ok && (media.isImage ? candidate.headers.get("content-type")?.startsWith("image/") === true : candidate.headers.get("content-type")?.includes("application/pdf") === true);
        const response = await requestWithRetry(
          () => fetch(media.previewUrl, { cache: "no-store" }),
          2,
          1_000,
          validResponse,
        );
        if (!validResponse(response)) throw new Error(`HTTP ${response.status}`);
        const blob = await response.blob();
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setSource(objectUrl);
      } catch {
        if (!cancelled) setLoadError("file_service_busy");
      }
    })();
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [media.isImage, media.previewUrl, retryKey]);

  return <ExpenseDialog className="detail-backdrop expense-media-backdrop" label={media.name} onClose={close} closeOnBackdrop><section className={`expense-media-preview${media.isImage ? " image" : ""}`}><button className="close" aria-label={tx(language, "Close preview", "Cerrar vista previa")} onClick={close}>×</button>{source ? media.isImage ? <Image unoptimized src={source} width={1500} height={1000} alt={media.name} /> : <iframe title={media.name} src={source} /> : loadError ? <div className="expense-media-status error"><b>{tx(language, "The file service is temporarily busy.", "El servicio de archivos está temporalmente ocupado.")}</b><span>{tx(language, "Your document was not changed. Wait a moment and retry.", "Tu documento no cambió. Esperá un momento y reintentá.")}</span><button onClick={() => { setSource(""); setLoadError(""); setRetryKey((value) => value + 1); }}>{tx(language, "Retry preview", "Reintentar vista previa")}</button></div> : <div className="expense-media-status"><b>{tx(language, "Opening document…", "Abriendo documento…")}</b><span>{tx(language, "This can take a few seconds for large PDFs.", "Los PDF grandes pueden tardar unos segundos.")}</span></div>}<strong>{media.name}</strong></section></ExpenseDialog>;
}

export default function ExpensesWorkspace({ mode, language, isOwner, projectId, paymentContext, onPaymentClose, onPaymentSaved }: {
  mode: "demo" | "real"; language: Language; isOwner: boolean; projectId?: string;
  compact?: boolean; onSaved?: (total: number, budgetLineId: string, amount: number) => void;
  paymentContext?: { budgetLineId: string; item: string; paymentId?: string; paymentsModelVersion?: number };
  onPaymentClose?: () => void;
  onPaymentSaved?: (payment: { budgetLineId: string; amount: number }) => void | Promise<void>;
}) {
  const [tab, setTab] = useState<Tab>("purchases");
  const [paidState, setPaid] = useState<PaidPayload | null>(mode === "demo" ? demoPaid : null);
  const paymentCurrency = mode === "demo" ? "USD" : projectCurrency(paidState?.currency);
  const [purchaseState, setPurchaseData] = useState<PurchasePayload>(mode === "demo" ? { purchases: [demoPurchase] } : { purchases: [] });
  const [documentState, setDocumentData] = useState<DocumentPayload>(mode === "demo" ? { documents: [demoDocument], purchases: [{ id: demoPurchase.id, title: demoPurchase.title, budgetLineId: demoLine.id }] } : { documents: [], purchases: [] });
  const [paymentState, setPaymentData] = useState<PaymentPayload>(mode === "demo" ? { payments: [demoPayment], completedLineIds: [] } : { payments: [], completedLineIds: [] });
  const [purchaseDraftState, setPurchaseDraft] = useState<PurchaseDraft | null>(null);
  const [documentDraftState, setDocumentDraft] = useState<DocumentDraft | null>(null);
  const [paymentDraftState, setPaymentDraft] = useState<PaymentDraft | null>(null);
  const [detailState, setDetail] = useState<PurchaseRecord | null>(null);
  const [embeddedPaymentClosed, setEmbeddedPaymentClosed] = useState(false);
  const [embeddedPaymentCommitted, setEmbeddedPaymentCommitted] = useState(false);
  const initializedPaymentContext = useRef("");
  const closeEmbeddedPayment = () => { setEmbeddedPaymentClosed(true); onPaymentClose?.(); };

  const [purchaseFields, setPurchaseFields] = useState<string[]>([]);
  const [documentFields, setDocumentFields] = useState<string[]>([]);
  const [paymentFields, setPaymentFields] = useState<string[]>([]);
  const paid = useMemo(() => mode === "demo" && paidState ? { ...paidState, budgetLines: paidState.budgetLines.map((item) => projectDemoExpense(item, language)), expenses: paidState.expenses.map((item) => projectDemoExpense(item, language)) } : paidState, [mode, language, paidState]);
  const purchaseData = useMemo(() => mode === "demo" ? { ...purchaseState, purchases: purchaseState.purchases.map((item) => projectDemoExpense(item, language)) } : purchaseState, [mode, language, purchaseState]);
  const documentData = useMemo(() => mode === "demo" ? { ...documentState, purchases: documentState.purchases.map((item) => projectDemoExpense(item, language)), documents: documentState.documents.map((item) => ({ ...projectDemoExpense(item, language), budgetLines: item.budgetLines.map((line) => projectDemoExpense(line, language)) })) } : documentState, [mode, language, documentState]);
  const paymentData = useMemo(() => mode === "demo" ? { ...paymentState, payments: paymentState.payments.map((item) => projectDemoExpense(item, language)) } : paymentState, [mode, language, paymentState]);
  const paymentsModelVersion = paymentData.paymentsModelVersion === 2 ? 2 : 1;
  const paymentVersionBody = paymentsModelVersion === 2 ? { paymentsModelVersion: 2 } : {};
  const purchaseDraft = mode === "demo" && purchaseDraftState ? projectDemoExpense(purchaseDraftState, language, purchaseFields) : purchaseDraftState;
  const documentDraft = mode === "demo" && documentDraftState ? projectDemoExpense(documentDraftState, language, documentFields) : documentDraftState;
  const paymentDraft = mode === "demo" && paymentDraftState ? projectDemoExpense(paymentDraftState, language, paymentFields) : paymentDraftState;
  const detail = mode === "demo" && detailState ? projectDemoExpense(detailState, language) : detailState;
  const updatePurchaseDraft = (next: PurchaseDraft | null) => { if (mode === "demo" && purchaseDraft && next) setPurchaseFields((fields) => [...new Set([...fields, ...changedDraftFields(purchaseDraft, next)])]); setPurchaseDraft(next); };
  const updateDocumentDraft = (next: DocumentDraft | null) => { if (mode === "demo" && documentDraft && next) setDocumentFields((fields) => [...new Set([...fields, ...changedDraftFields(documentDraft, next)])]); setDocumentDraft(next); };
  const updatePaymentDraft = (next: PaymentDraft | null) => {
    if (paymentContext && !next) { closeEmbeddedPayment(); return; }
    const scopedNext = next && paymentContext ? { ...next, budgetLineId: paymentContext.budgetLineId } : next;
    const updated = scopedNext && paymentDraft && scopedNext.budgetLineId !== paymentDraft.budgetLineId ? { ...scopedNext, accountingMode: initialPaymentAccounting(mode, scopedNext.budgetLineId, paid?.budgetLines || [], paymentData.payments, paymentsModelVersion) } : scopedNext;
    if (mode === "demo" && paymentDraft && updated) setPaymentFields((fields) => [...new Set([...fields, ...changedDraftFields(paymentDraft, updated)])]);
    setPaymentDraft(updated);
  };

  const [preview, setPreview] = useState<ExpenseMedia | null>(null);
  const openMedia = (media: ExpenseMedia) => {
    trackUsageInteraction("document.open");
    setPreview(media);
  };
  const [purchaseFiles, setPurchaseFiles] = useState<File[]>([]);
  const [documentFiles, setDocumentFiles] = useState<File[]>([]);
  const [paymentFiles, setPaymentFiles] = useState<File[]>([]);
  const [receiptToLink, setReceiptToLink] = useState<ExpenseDocumentRecord | null>(null);
  const [linkPaymentQuery, setLinkPaymentQuery] = useState("");
  const [success, setSuccess] = useState("");
  const [query, setQuery] = useState("");
  const [lineFilter, setLineFilter] = useState("");
  const [linkAction, setLinkAction] = useState<"purchase" | "document" | "payment" | null>(null);
  const [createdPurchaseId, setCreatedPurchaseId] = useState("");
  const handledAction = useRef("");
  useEffect(() => {
    if (paymentContext) return;
    const readScope = () => {
      const params = new URLSearchParams(window.location.search);
      const id = params.get("budgetLine") || "";
      setLineFilter(id);
      const requested = params.get("expenseTab");
      if (requested === "paid" || requested === "purchases" || requested === "documents" || requested === "payments") setTab(requested);
      else if (id) setTab("documents");
      setLinkAction(params.get("newPayment") === "1" ? "payment" : params.get("newDocument") === "1" ? "document" : params.get("newExpense") === "1" ? "purchase" : null);
    };
    const timer = window.setTimeout(readScope, 0);
    window.addEventListener("popstate", readScope);
    return () => { window.clearTimeout(timer); window.removeEventListener("popstate", readScope); };
  }, [paymentContext]);
  const [linkedFilter, setLinkedFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("");
  const [paidQuery, setPaidQuery] = useState("");
  const [paidChapterFilter, setPaidChapterFilter] = useState("");
  const [paidStatusFilter, setPaidStatusFilter] = useState<PaidStatusFilter>("all");
  const [busy, setBusy] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<UploadProgressState | null>(null);
  const [error, setError] = useState("");
  const photosRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const documentsRef = useRef<HTMLInputElement>(null);

  const refresh = async () => {
    if (mode === "demo") return;
    const [a, b, c, d] = await Promise.all([fetch("/api/expenses", { cache: "no-store" }), fetch("/api/expenses/purchases", { cache: "no-store" }), fetch("/api/expenses/documents", { cache: "no-store" }), fetch("/api/expenses/payments", { cache: "no-store" })]);
    const [nextPaid, nextPurchases, nextDocuments, nextPayments] = await Promise.all([requestJson<PaidPayload>(a), requestJson<PurchasePayload>(b), requestJson<DocumentPayload>(c), requestJson<PaymentPayload>(d)]);
    setPaid(nextPaid); setPurchaseData(nextPurchases); setDocumentData(nextDocuments); setPaymentData(nextPayments);
  };
  useEffect(() => { const timer = window.setTimeout(() => { void refresh().catch((reason) => setError(reason instanceof Error ? reason.message : "Gastos no disponibles")); }, 0); return () => window.clearTimeout(timer); }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps

  const embeddedLineId = paymentContext?.budgetLineId || "";
  const embeddedPaymentId = paymentContext?.paymentId || "";
  const embeddedIdentity = `${embeddedLineId}:${embeddedPaymentId || "new"}`;
  const embeddedPayment = embeddedPaymentId ? paymentData.payments.find((item) => item.id === embeddedPaymentId && item.budgetLineId === embeddedLineId) : undefined;
  const embeddedVersionMismatch = paymentContext?.paymentsModelVersion === 2 && paid !== null && paymentsModelVersion !== 2;
  useEffect(() => {
    if (!embeddedLineId || !isOwner || !paid || embeddedPaymentClosed || embeddedVersionMismatch || initializedPaymentContext.current === embeddedIdentity) return;
    const line = paid.budgetLines.find((item) => item.id === embeddedLineId);
    if (mode === "real" && (!line || embeddedPaymentId && !embeddedPayment)) return;
    const timer = window.setTimeout(() => {
      initializedPaymentContext.current = embeddedIdentity;
      setPaymentFields([]); setPaymentFiles([]);
      setPaymentDraft(embeddedPayment ? paymentFromRecord(embeddedPayment) : { ...paymentBlank(embeddedLineId, paymentCurrency), accountingMode: initialPaymentAccounting(mode, embeddedLineId, paid.budgetLines, paymentData.payments, paymentsModelVersion), payee: line?.supplier || "" });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [embeddedLineId, embeddedPaymentId, embeddedIdentity, embeddedPayment, embeddedVersionMismatch, isOwner, paid, mode, embeddedPaymentClosed, paymentData.payments, paymentsModelVersion, paymentCurrency]);

  const scopedLine = paid?.budgetLines.find((line) => line.id === lineFilter);
  const scopedPurchases = purchaseData.purchases.filter((item) => !lineFilter || item.budgetLineId === lineFilter);
  const scopedDocuments = documentData.documents.filter((item) => !lineFilter || documentLineIds(item).includes(lineFilter)
    || scopedPurchases.some((purchase) => purchase.id === item.purchaseId)
    || paymentData.payments.some((payment) => payment.budgetLineId === lineFilter && paymentDocumentIds(payment).includes(item.id)));
  const canCreateScoped = !lineFilter || Boolean(scopedLine);
  const backToBudget = projectId ? buildWorkspacePath({ projectId, section: "budget", budgetScope: scopedLine?.chapter ? { key: "chapter", label: scopedLine.chapter } : null }) + (mode === "demo" ? "?mode=demo" : "") : null;
  const clearLineScope = () => {
    const url = new URL(window.location.href);
    for (const key of ["budgetLine", "newExpense", "newDocument", "newPayment", "paymentKind", "purchaseId"]) url.searchParams.delete(key);
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    setLineFilter(""); setLinkAction(null); setQuery(""); setPaidQuery(""); setPaidChapterFilter(""); setPaidStatusFilter("all");
  };
  useEffect(() => {
    if (paymentContext || !linkAction || !isOwner || !paid || (lineFilter && !scopedLine) || handledAction.current === `${lineFilter}:${linkAction}`) return;
    const timer = window.setTimeout(() => {
      handledAction.current = `${lineFilter}:${linkAction}`;
      if (linkAction === "payment") {
        const params = new URLSearchParams(window.location.search);
        const purchaseId = params.get("purchaseId") || "";
        setTab("payments"); setPaymentFields([]); setPaymentFiles([]);
        setPaymentDraft({ ...paymentBlank(scopedLine?.id || "", paymentCurrency), accountingMode: initialPaymentAccounting(mode, scopedLine?.id || "", paid.budgetLines, paymentData.payments, paymentsModelVersion), purchaseId, paymentKind: params.get("paymentKind") === "settlement" ? "settlement" : "partial", payee: scopedLine?.supplier || "" });
      } else if (linkAction === "purchase") {
        setTab("purchases"); setPurchaseFields([]); setPurchaseFiles([]);
        setPurchaseDraft({ ...purchaseBlank(scopedLine?.id || "", paymentCurrency), title: scopedLine?.item || "", vendor: scopedLine?.supplier || "" });
      } else {
        setTab("documents"); setDocumentFields([]); setDocumentFiles([]);
        setDocumentDraft(documentBlank("", "", paymentCurrency));
      }
      const url = new URL(window.location.href);
      url.searchParams.delete("newExpense"); url.searchParams.delete("newDocument"); url.searchParams.delete("newPayment");
      url.searchParams.set("expenseTab", linkAction === "purchase" ? "purchases" : linkAction === "payment" ? "payments" : "documents");
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
      setLinkAction(null);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [linkAction, isOwner, scopedLine, lineFilter, paid, paymentContext, mode, paymentCurrency, paymentData.payments, paymentsModelVersion]);

  const paidLines: PaidLine[] = mode === "demo" ? [projectDemoExpense(demoLine, language)] : (paid?.budgetLines || []).map((line) => ({ id: line.id, label: line.item, chapter: line.chapter, supplier: line.supplier, paid: line.paid, workbookPaid: line.workbookPaid }));
  const purchaseMap = useMemo(() => new Map(purchaseData.purchases.map((item) => [item.id, item])), [purchaseData.purchases]);
  const receiptUses = useMemo(() => {
    const counts = new Map<string, number>();
    paymentData.payments.forEach((item) => paymentDocumentIds(item).forEach((id) => counts.set(id, (counts.get(id) || 0) + 1)));
    return counts;
  }, [paymentData.payments]);
  const purchaseBalance = (item: PurchaseRecord, excludePaymentId?: string) => item.currency === paymentCurrency && item.amount !== null ? Math.max(0, Math.round((item.amount - paymentData.payments.filter((payment) => payment.purchaseId === item.id && payment.id !== excludePaymentId).reduce((sum, payment) => sum + payment.amount, 0)) * 100) / 100) : null;
  const visiblePayments = paymentData.payments.filter((item) => (!lineFilter || item.budgetLineId === lineFilter) && searchKey(`${paymentRecordTitle(item, language)} ${item.payee} ${item.reference} ${item.notes} ${item.budgetLineLabel}`).includes(searchKey(query)));
  const cover = (item: PurchaseRecord) => item.photos.find((photo) => photo.id === item.coverPhotoId) || item.photos[0];
  const purchases = purchaseData.purchases.filter((item) => `${item.title} ${item.vendor} ${item.reference} ${item.notes} ${item.outsideObjective ? "Outside objective Fuera de objetivo" : ""} ${item.budgetLineLabel}`.toLowerCase().includes(query.toLowerCase()) && (!lineFilter || item.budgetLineId === lineFilter) && (linkedFilter === "all" || (linkedFilter === "linked") === Boolean(item.budgetLineId)));
  const documents = scopedDocuments.filter((item) => `${item.title} ${item.vendor} ${item.reference} ${item.notes} ${item.outsideObjective ? "Outside objective Fuera de objetivo" : ""} ${item.purchaseTitle} ${(item.budgetLines || []).map((line) => line.label).join(" ")} ${item.budgetLineLabel}`.toLowerCase().includes(query.toLowerCase()) && (!typeFilter || item.documentType === typeFilter) && (linkedFilter === "all" || (linkedFilter === "linked") === Boolean(receiptUses.get(item.id))));
  const paidExpenses = useMemo(() => paid?.expenses || [], [paid]);
  const paidChapters = useMemo(() => [...new Set((paidState?.expenses || []).map((line) => line.chapter).filter(Boolean))].sort((a, b) => a.localeCompare(b, language === "es" ? "es" : "en")), [language, paidState]);
  const paymentsByLine = useMemo(() => {
    const result = new Map<string, ExpensePaymentRecord[]>();
    paymentData.payments.forEach((item) => { if (!item.budgetLineId) return; const group = result.get(item.budgetLineId); if (group) group.push(item); else result.set(item.budgetLineId, [item]); });
    return result;
  }, [paymentData.payments]);
  const purchasesByLine = useMemo(() => {
    const result = new Map<string, PurchaseRecord[]>();
    purchaseData.purchases.forEach((item) => { if (item.budgetLineId) { const group = result.get(item.budgetLineId); if (group) group.push(item); else result.set(item.budgetLineId, [item]); } });
    return result;
  }, [purchaseData.purchases]);
  const documentsByLine = useMemo(() => {
    const result = new Map<string, ExpenseDocumentRecord[]>();
    documentData.documents.forEach((item) => documentLineIds(item).forEach((id) => { const group = result.get(id); if (group) group.push(item); else result.set(id, [item]); }));
    paymentData.payments.forEach((payment) => { if (!payment.budgetLineId) return; const group = result.get(payment.budgetLineId) || []; for (const id of paymentDocumentIds(payment)) { const document = documentData.documents.find((item) => item.id === id); if (document && !group.some((item) => item.id === id)) group.push(document); } result.set(payment.budgetLineId, group); });
    return result;
  }, [documentData.documents, paymentData.payments]);
  const filteredPaidExpenses = useMemo(() => {
    const needle = searchKey(paidQuery.trim());
    return paidExpenses.filter((line) => {
      if (lineFilter && line.id !== lineFilter && line.budgetLineId !== lineFilter) return false;
      if (needle && !searchKey(`${line.chapter} ${line.subcategory} ${line.description} ${line.vendor}`).includes(needle)) return false;
      if (paidChapterFilter && (paidState?.expenses.find((item) => item.id === line.id)?.chapter || line.chapter) !== paidChapterFilter) return false;
      const payments = paymentsByLine.get(line.id) || [];
      const detailed = payments.reduce((sum, item) => sum + item.amount, 0);
      const complete = paymentData.completedLineIds.includes(line.id) || Math.abs(line.amount - detailed) < 0.005;
      const hasFiles = Boolean((purchasesByLine.get(line.id) || []).length || (documentsByLine.get(line.id) || []).length || line.attachments.length);
      if (paymentsModelVersion !== 2 && paidStatusFilter === "needs-detail") return !complete;
      if (paymentsModelVersion !== 2 && paidStatusFilter === "complete") return complete;
      if (paidStatusFilter === "with-files") return hasFiles;
      if (paidStatusFilter === "without-files") return !hasFiles;
      return true;
    });
  }, [lineFilter, documentsByLine, paidChapterFilter, paidExpenses, paidState, paidQuery, paidStatusFilter, paymentData.completedLineIds, paymentsByLine, purchasesByLine, paymentsModelVersion]);
  const hasPaidFilters = Boolean(paidQuery || paidChapterFilter || paidStatusFilter !== "all");

  const editPurchase = (item?: PurchaseRecord, lineId = "") => {
    setPurchaseFields([]); setDetail(null); setPurchaseFiles([]); setError(""); setUploadProgress(null);
    setCreatedPurchaseId("");
    setPurchaseDraft(item ? { id: item.id, title: item.title, purchaseDate: item.purchaseDate, vendor: item.vendor, reference: item.reference, notes: item.notes, amount: item.amount === null ? "" : String(item.amount), currency: item.currency, budgetLineId: item.outsideObjective ? "outside-objective" : item.budgetLineId || "", coverPhotoId: item.coverPhotoId } : { ...purchaseBlank(lineId || scopedLine?.id || "", paymentCurrency), title: scopedLine?.item || "", vendor: scopedLine?.supplier || "" });
  };
  const editDocument = (item?: ExpenseDocumentRecord, ..._legacyScope: Array<string | undefined>) => {
    void _legacyScope;
    setDocumentFields([]); setDocumentFiles([]); setError(""); setUploadProgress(null); setSuccess("");
    setDocumentDraft(item ? { id: item.id, title: item.title, documentType: item.documentType, documentDate: item.documentDate, vendor: item.vendor, reference: item.reference, notes: item.notes, amount: item.amount === null ? "" : String(item.amount), currency: item.currency, purchaseId: item.purchaseId || "", budgetLineIds: documentLineIds(item) } : {
      ...documentBlank("", "", paymentCurrency),
    });
  };
  const editPayment = (lineId = "", item?: ExpensePaymentRecord, receiptId = "", purchase?: PurchaseRecord, settle = false) => {
    setPaymentFields([]); setPaymentFiles([]); setError(""); setSuccess(""); setReceiptToLink(null);
    const newLineId = lineId || purchase?.budgetLineId || "";
    setPaymentDraft(item ? paymentFromRecord(item) : {
      ...paymentBlank(newLineId, paymentCurrency), accountingMode: initialPaymentAccounting(mode, newLineId, paid?.budgetLines || [], paymentData.payments, paymentsModelVersion), documentIds: receiptId ? [receiptId] : [], purchaseId: purchase?.id || "", payee: purchase?.vendor || "",
      paymentKind: settle ? "settlement" : "partial", amount: settle && purchase ? String(purchaseBalance(purchase) ?? "") : "",
    });
  };
  const linkReceiptToPayment = async (payment: ExpensePaymentRecord) => {
    if (!receiptToLink || busy) return;
    setBusy(true); setError("");
    try {
      const documentIds = [...new Set([...paymentDocumentIds(payment), receiptToLink.id])];
      if (mode === "real") await requestJson(await fetch("/api/expenses/payments", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(paymentWriteBody({ ...payment, documentIds }, paymentsModelVersion, projectCurrency(payment.currency))) }));
      else setPaymentData((current) => ({ ...current, payments: current.payments.map((item) => item.id === payment.id ? { ...item, documentIds } : item) }));
      setReceiptToLink(null); setSuccess(tx(language, "Receipt linked. The payment amount did not change.", "Comprobante vinculado. El monto del pago no cambió.")); await refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : tx(language, "Could not link receipt", "No se pudo vincular el comprobante")); }
    finally { setBusy(false); }
  };

  const savePurchase = async () => {
    if (!purchaseDraft || busy) return;
    setBusy(true); setError(""); setUploadProgress(null);
    try {
      if (mode === "real") {
        const saved = await requestJson<{ id: string }>(await fetch("/api/expenses/purchases", { method: purchaseDraft.id ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...purchaseDraft, outsideObjective: purchaseDraft.budgetLineId === "outside-objective", budgetLineId: purchaseDraft.budgetLineId === "outside-objective" ? null : purchaseDraft.budgetLineId || null }) }));
        const id = purchaseDraft.id || saved.id;
        if (!purchaseDraft.id) setCreatedPurchaseId(id);
        setPurchaseDraft({ ...purchaseDraft, id });
        if (purchaseFiles.length) { const form = new FormData(); form.append("purchaseId", id); purchaseFiles.forEach((file) => form.append("files", file)); await requestJson(await uploadFormData("/api/expenses/purchases/photos", form, { onProgress: setUploadProgress })); }
      } else {
        trackDemoAction(purchaseDraft.id ? "record.update" : "record.create");
        purchaseFiles.forEach(() => trackDemoAction("file.upload"));
      }
      setUploadProgress(null); setPurchaseDraft(null); await refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo guardar"); } finally { setBusy(false); }
  };
  const saveDocument = async () => {
    if (!documentDraft || busy) return;
    setBusy(true); setError(""); setUploadProgress(null);
    try {
      if (mode === "real" && documentDraft.id) await requestJson(await fetch("/api/expenses/documents", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(documentDraft) }));
      if (mode === "real" && !documentDraft.id) { const form = new FormData(); Object.entries(documentDraft).forEach(([key, value]) => { if (key !== "budgetLineIds") form.append(key, String(value)); }); documentDraft.budgetLineIds.forEach((id) => form.append("budgetLineIds", id)); documentFiles.forEach((file) => form.append("files", file)); await requestJson(await uploadFormData("/api/expenses/documents", form, { onProgress: setUploadProgress })); }
      if (mode === "real" && documentDraft.id && documentFiles.length) { const form = new FormData(); form.append("documentId", documentDraft.id); documentFiles.forEach((file) => form.append("files", file)); await requestJson(await uploadFormData("/api/expenses/documents/files", form, { onProgress: setUploadProgress })); }
      if (mode === "demo") {
        trackDemoAction(documentDraft.id ? "record.update" : "record.create");
        if (documentDraft.id && documentFiles.length) trackDemoAction("file.upload");
      }
      setUploadProgress(null); setDocumentDraft(null); setDocumentFiles([]); setTab("documents"); clearLineScope(); setLinkedFilter("all");
      setSuccess(tx(language, "Receipt saved. Link it to a payment whenever you are ready. No expense was recorded.", "Comprobante guardado. Podés vincularlo a un pago después. No se registró ningún gasto.")); await refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo guardar"); } finally { setBusy(false); }
  };
  const savePayment = async () => {
    // Typed amounts are normalized by the input. Keep decimals supplied by an
    // existing payment or an exact purchase balance intact.
    const amount = paymentDraft?.amount.trim() || "";
    if (!paymentDraft || !amount || !Number.isFinite(Number(amount)) || Number(amount) <= 0) return setError(tx(language, "Enter a payment amount greater than zero", "Ingresá un monto de pago mayor que cero"));
    if (mode === "real" && paymentsModelVersion !== 2 && !paymentDraft.accountingMode) return setError(tx(language, "Indicate whether this is a new payment or already included in Excel", "Indica si es un pago nuevo o ya incluido en Excel"));
    if (mode === "real" && paymentsModelVersion !== 2 && paymentDraft.accountingMode === "historical-detail") {
      const lineId = paymentContext?.budgetLineId || paymentDraft.budgetLineId;
      const available = availableHistoricalPayment(paid?.budgetLines || [], paymentData.payments, lineId, paymentDraft.id);
      if (!lineId || historicalPaymentBase(paid?.budgetLines || [], paymentData.payments, lineId) <= 0) return setError(tx(language, "Select a budget item with an existing Excel paid amount", "Seleccioná una partida con un importe pagado existente en Excel"));
      if (Number(amount) - available > .005) return setError(tx(language, `Only ${cash(available, paymentCurrency, language)} of Excel history remains to detail`, `Solo quedan ${cash(available, paymentCurrency, language)} del histórico de Excel por detallar`));
    }
    if (busy) return;
    setBusy(true); setError(""); setUploadProgress(null);
    try {
      const documentIds = [...paymentDraft.documentIds];
      for (const file of paymentFiles) {
        if (file.size > 25 * 1024 * 1024) throw new Error(tx(language, "Each file is limited to 25 MB", "Cada archivo está limitado a 25 MB"));
        if (mode === "real") {
          const form = new FormData(); form.append("title", file.name); form.append("files", file);
          const saved = await requestJson<{ id: string }>(await uploadFormData("/api/expenses/documents", form, { onProgress: setUploadProgress }));
          documentIds.push(saved.id);
          setPaymentDraft((current) => current ? { ...current, documentIds: [...new Set([...current.documentIds, saved.id])] } : current);
        }
        setPaymentFiles((current) => current.filter((item) => item !== file));
      }
      if (mode === "real") {
        const request = () => fetch("/api/expenses/payments", { method: paymentDraft.id ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(paymentWriteBody({ ...paymentDraft, budgetLineId: paymentContext?.budgetLineId || paymentDraft.budgetLineId || null, purchaseId: paymentDraft.purchaseId || null, documentIds: [...new Set(documentIds)], amount: Number(amount) }, paymentsModelVersion, paymentDraft.expectedCurrency)) });
        await requestJsonWithRetry(request, paymentDraft.id ? 2 : 0);
      } else {
        trackDemoAction(paymentDraft.id ? "record.update" : "record.create");
      }
      if (paymentContext) {
        // The payment is committed. A budget refresh failure must never expose
        // the payment form again or make its save button submit a second time.
        setEmbeddedPaymentCommitted(true); setPaymentDraft(null); setPaymentFiles([]);
        try {
          await onPaymentSaved?.({ budgetLineId: paymentContext.budgetLineId, amount: Number(amount) });
          closeEmbeddedPayment();
        } catch {
          setError(tx(language, "Payment saved. The budget could not be refreshed; reload it to see the updated paid total.", "Pago guardado. No se pudo actualizar el presupuesto; recargalo para ver el acumulado pagado."));
        }
        return;
      }
      setPaymentDraft(null); setPaymentFiles([]); setSuccess(tx(language, "Payment saved with its receipts.", "Pago guardado con sus comprobantes.")); setTab("payments"); await refresh();
    } catch (reason) { setError(reason instanceof UnexpectedApiResponseError ? tx(language, "The server is temporarily busy. Retry this form to check the same payment.", "El servidor está temporalmente ocupado. Reintentá este formulario para comprobar el mismo pago.") : reason instanceof Error ? reason.message : "No se pudo guardar el pago"); } finally { setBusy(false); setUploadProgress(null); }
  };
  const setPaymentComplete = async (budgetLineId: string, complete: boolean) => {
    const previous = paymentData.completedLineIds;
    setBusy(true); setError("");
    setPaymentData((current) => ({ ...current, completedLineIds: complete ? [...new Set([...current.completedLineIds, budgetLineId])] : current.completedLineIds.filter((id) => id !== budgetLineId) }));
    try {
      if (mode === "real") await requestJson(await fetch("/api/expenses/payments", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "set-complete", budgetLineId, complete, ...paymentVersionBody }) }));
      else trackDemoAction("record.update");
      await refresh();
    } catch (reason) { setPaymentData((current) => ({ ...current, completedLineIds: previous })); setError(reason instanceof Error ? reason.message : "No se pudo actualizar el estado del pago"); } finally { setBusy(false); }
  };
  const remove = async (kind: "purchase" | "document" | "payment", id: string, label = "") => {
    const noun = kind === "purchase" ? tx(language, "purchase", "compra") : kind === "document" ? tx(language, "document", "comprobante") : tx(language, "payment", "pago");
    const preserved = kind === "purchase" ? ` ${tx(language, "Its related documents will be preserved.", "Sus comprobantes relacionados se conservarán.")}` : "";
    if (!window.confirm(`${tx(language, "Delete", "¿Eliminar")} ${noun}${label ? ` “${label}”` : ""}?${preserved}`)) return;
    setBusy(true);
    try { if (mode === "real") await requestJson(await fetch(`${kind === "purchase" ? "/api/expenses/purchases" : kind === "document" ? "/api/expenses/documents" : "/api/expenses/payments"}?id=${encodeURIComponent(id)}`, { method: "DELETE", ...(kind === "payment" && paymentsModelVersion === 2 ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(paymentVersionBody) } : {}) })); else trackDemoAction("record.delete"); setPurchaseDraft(null); setDocumentDraft(null); setPaymentDraft(null); setDetail(null); await refresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo eliminar"); } finally { setBusy(false); }
  };
  const quickLink = async (kind: "purchase" | "document", id: string, budgetLineId: string) => {
    const source = kind === "purchase" ? purchaseMap.get(id) : documentData.documents.find((item) => item.id === id);
    if (!source) return; setBusy(true); setError("");
    try { if (mode === "real") await requestJson(await fetch(kind === "purchase" ? "/api/expenses/purchases" : "/api/expenses/documents", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(kind === "document" ? { ...source, budgetLineIds: [...new Set([...documentLineIds(source as ExpenseDocumentRecord), budgetLineId])] } : { ...source, budgetLineId }) })); else trackDemoAction("record.update"); await refresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo vincular"); } finally { setBusy(false); }
  };
  const removeMedia = async (kind: "photo" | "document", ownerId: string, fileId: string) => {
    setBusy(true); setError("");
    try {
      const url = kind === "photo" ? `/api/expenses/purchases/photos?id=${encodeURIComponent(fileId)}` : `/api/expenses/documents/files?documentId=${encodeURIComponent(ownerId)}&fileId=${encodeURIComponent(fileId)}`;
      if (mode === "real") await requestJson(await fetch(url, { method: "DELETE" }));
      else trackDemoAction("record.delete");
      await refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo eliminar el archivo"); } finally { setBusy(false); }
  };
  const removeLegacyInvoice = async (attachment: ExpenseRecord["attachments"][number]) => {
    if (!window.confirm(`${tx(language, "Delete invoice", "¿Eliminar factura")} “${attachment.fileName}”? ${tx(language, "If it is used elsewhere, it will remain available there.", "Si se usa en otro lugar, se conservará allí.")}`)) return;
    setBusy(true); setError("");
    try {
      if (mode === "real") {
        await requestJson(await fetch(`/api/expenses?id=${encodeURIComponent(attachment.id)}`, { method: "DELETE" }));
        const response = await fetch(`/api/expenses/files?id=${encodeURIComponent(attachment.documentId)}`, { method: "DELETE" });
        if (!response.ok && response.status !== 409) await requestJson(response);
      } else {
        trackDemoAction("record.delete");
      }
      await refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo eliminar la factura"); } finally { setBusy(false); }
  };

  if (paymentContext) {
    if (embeddedPaymentClosed) return null;
    const lineAvailable = mode === "demo" || paid?.budgetLines.some((line) => line.id === paymentContext.budgetLineId);
    const paymentUnavailable = Boolean(embeddedPaymentId && paid && !embeddedPayment);
    if (isOwner && lineAvailable && !paymentUnavailable && !embeddedVersionMismatch && paymentDraft && !embeddedPaymentCommitted) return <PaymentForm currency={paymentDraft.expectedCurrency} draft={paymentDraft} setDraft={updatePaymentDraft} documents={documentData.documents} lines={paidLines} purchases={purchaseData.purchases} receiptUses={receiptUses} files={paymentFiles} setFiles={setPaymentFiles} uploadProgress={uploadProgress} purchaseBalance={(purchase) => purchaseBalance(purchase, paymentDraft.id)} language={language} busy={busy} error={error} clearError={() => setError("")} save={savePayment} lockedBudgetLine={{ id: paymentContext.budgetLineId, label: paymentContext.item }} accountingPayments={mode === "real" ? paymentData.payments : undefined} paymentsModelVersion={paymentsModelVersion} imported={Boolean(embeddedPayment && isExcelImportedPayment(embeddedPayment))} />;
    const unavailable = !isOwner ? tx(language, "You cannot record payments with your current access.", "Tu acceso actual no permite registrar pagos.") : embeddedVersionMismatch ? tx(language, "The payment model changed. Close and refresh the budget.", "El modelo de pagos cambió. Cerrá y recargá el presupuesto.") : paymentUnavailable ? tx(language, "This payment is no longer available for this budget item. Close and refresh the history.", "Este pago ya no está disponible en esta partida. Cerrá y recargá el historial.") : paid && !lineAvailable ? tx(language, "This budget item is no longer available. Close and refresh the budget.", "Esta partida ya no está disponible. Cerrá y recargá el presupuesto.") : "";
    return <ExpenseDialog className="detail-backdrop expense-form-backdrop" label={tx(language, "Payment", "Pago")} onClose={closeEmbeddedPayment} busy={busy}><section className="expense-form payment-form">
      <button className="close" aria-label={tx(language, "Close payment", "Cerrar pago")} disabled={busy} onClick={closeEmbeddedPayment}>×</button>
      <h2>{embeddedPaymentCommitted ? tx(language, "Payment saved", "Pago guardado") : tx(language, "Payment", "Pago")}</h2><p><b>{paymentContext.item}</b></p>
      {error || unavailable ? <p role="alert" className="payment-form-error">{error || unavailable}</p> : <p role="status">{embeddedPaymentCommitted ? tx(language, "Updating the paid total…", "Actualizando el acumulado pagado…") : tx(language, "Loading payment options…", "Cargando opciones del pago…")}</p>}
      <footer>{error && !embeddedPaymentCommitted && !unavailable && <button className="expense-edit" disabled={busy} onClick={() => { setError(""); setBusy(true); void refresh().catch((reason) => setError(reason instanceof Error ? reason.message : tx(language, "Payment options could not be loaded.", "No se pudieron cargar las opciones del pago."))).finally(() => setBusy(false)); }}>{tx(language, "Retry", "Reintentar")}</button>}<button className="expense-edit" disabled={busy} onClick={closeEmbeddedPayment}>{tx(language, "Close", "Cerrar")}</button></footer>
    </section></ExpenseDialog>;
  }

  return <div className="expenses-page">
    {lineFilter && <section className="expense-budget-scope" aria-label={tx(language, "Selected budget line", "Partida seleccionada")}><div>{backToBudget && <a href={backToBudget}>← {tx(language, "Back to budget", "Volver a presupuesto")}</a>}<h2>{scopedLine?.item || tx(language, "Budget line unavailable", "Partida no disponible")}</h2><p>{scopedLine ? [scopedLine.chapter, scopedLine.subcategory].filter(Boolean).join(" · ") : tx(language, "This line no longer exists in the official budget. Its linked records are retained.", "Esta partida ya no existe en el presupuesto oficial. Sus registros vinculados se conservan.")}</p></div><button className="secondary-button" onClick={clearLineScope}>{tx(language, "View all purchases", "Ver todas las compras")}</button></section>}
    {createdPurchaseId && purchaseMap.has(createdPurchaseId) && <section className="expense-next-step"><p role="status">{tx(language, "Purchase saved. Receipts can be uploaded now and linked to a payment later.", "Compra guardada. Podés subir comprobantes ahora y vincularlos a un pago después.")}</p><button className="expense-primary" disabled={busy} onClick={() => editDocument(undefined, purchaseMap.get(createdPurchaseId)?.budgetLineId || "", createdPurchaseId)}>＋ {tx(language, "Add document", "Agregar comprobante")}</button></section>}
    <header className="expense-summary-bar"><div><p>{paymentsModelVersion === 2 ? tx(language, "Save receipts whenever you have them. All payments are listed together; Excel amounts without details appear as editable payments.", "Guardá comprobantes cuando los tengás. Todos los pagos están juntos; los importes de Excel sin detalle aparecen como pagos editables.") : tx(language, "Save receipts whenever you have them. Record each payment separately; the budget includes recorded payments and reconciled Excel history.", "Guardá comprobantes cuando los tengás. Registrá cada pago por separado; el presupuesto incluye los pagos nuevos y el histórico conciliado de Excel.")}</p>{isOwner && <div className="expense-main-actions"><button className="expense-edit" disabled={busy} onClick={() => editDocument()}>{tx(language, "Upload receipts", "Subir comprobantes")}</button><button className="expense-primary" disabled={busy} onClick={() => editPayment(scopedLine?.id || "")}>{tx(language, "Record payment", "Registrar pago")}</button></div>}</div>{paid && <div className="expense-total"><span>{lineFilter ? tx(language, "Paid toward this budget item", "Pagado en esta partida") : tx(language, "Paid in budget", "Pagado en presupuesto")}</span><strong>{cash(lineFilter ? scopedLine?.paid || 0 : paid.summary.total, paymentCurrency, language)}</strong></div>}</header>
    <nav className="expense-tabs">{(["purchases", "documents", "payments", "paid"] as Tab[]).map((key) => <button key={key} aria-label={key === "paid" ? tx(language, "Paid lines", "Partidas pagadas") : undefined} className={tab === key ? "active" : ""} onClick={() => { setTab(key); setQuery(""); if (lineFilter) { const url = new URL(window.location.href); url.searchParams.set("expenseTab", key); window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`); } if (mode === "real") void refresh().catch((reason) => setError(reason instanceof Error ? reason.message : "Gastos no disponibles")); }}>{key === "purchases" ? tx(language, "Products", "Productos") : key === "documents" ? tx(language, "Documents", "Comprobantes") : key === "payments" ? tx(language, "Payments", "Pagos") : tx(language, "Budget lines", "Partidas")}<small>{key === "purchases" ? scopedPurchases.length : key === "documents" ? scopedDocuments.length : key === "payments" ? visiblePayments.length : filteredPaidExpenses.length}</small></button>)}</nav>
    {success && <p className="expense-success" role="status">{success}</p>}{error && !paymentDraft && <div className="warning-banner" role="alert">{error}</div>}
    {(tab === "purchases" || tab === "documents") && <section className={`expense-toolbar ${tab === "documents" ? "documents" : ""}`}><input aria-label={tx(language, "Search purchases and receipts", "Buscar compras y comprobantes")} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={tx(language, "Search…", "Buscar…")} /><select aria-label={tx(language, "Budget line filter", "Filtrar por partida")} value={lineFilter} onChange={(event) => { const id = event.target.value; setLineFilter(id); const url = new URL(window.location.href); if (id) url.searchParams.set("budgetLine", id); else url.searchParams.delete("budgetLine"); window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`); }}><option value="">{tx(language, "All budget lines", "Todas las partidas")}</option>{lineFilter && !paidLines.some((line) => line.id === lineFilter) && <option value={lineFilter}>{scopedLine?.item || tx(language, "Unavailable item", "Partida no disponible")}</option>}{paidLines.map((line) => <option key={line.id} value={line.id}>{line.label}</option>)}</select>{tab === "documents" && <select aria-label={tx(language, "Document type", "Tipo de comprobante")} value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}><option value="">{tx(language, "All types", "Todos los tipos")}</option>{Object.entries(documentLabels(language)).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>}<select aria-label={tx(language, "Link status", "Estado de vinculación")} value={linkedFilter} onChange={(event) => setLinkedFilter(event.target.value)}><option value="all">{tab === "purchases" ? tx(language, "With or without budget line", "Con o sin partida") : tx(language, "All receipts", "Todos los comprobantes")}</option><option value="linked">{tab === "purchases" ? tx(language, "With budget line", "Con partida") : tx(language, "Linked to payments", "Vinculados a pagos")}</option><option value="unlinked">{tab === "purchases" ? tx(language, "Without budget line", "Sin partida") : tx(language, "Pending link", "Pendientes de vincular")}</option></select>{isOwner && canCreateScoped && <button className="expense-primary" onClick={() => tab === "purchases" ? editPurchase() : editDocument()}>＋ {tab === "purchases" ? tx(language, "New purchase", "Nueva compra") : tx(language, "New document", "Nuevo comprobante")}</button>}</section>}

    {tab === "purchases" && <section className="purchase-gallery">{purchases.length ? purchases.map((item) => { const image = cover(item); const secondary = [item.vendor, item.reference].filter(Boolean).join(" · "); return <article className="purchase-card" key={item.id}><button className="purchase-cover" onClick={() => setDetail(item)}>{image ? <Image unoptimized src={image.thumbnailUrl || image.previewUrl} width={720} height={500} alt={item.title} /> : <span><b>▧</b>{tx(language, "No product photos", "Sin fotos del producto")}</span>}{item.photos.length > 0 && <i>{item.photos.length} {item.photos.length === 1 ? tx(language, "photo", "foto") : tx(language, "photos", "fotos")}</i>}</button><div>{item.purchaseDate && <small>{item.purchaseDate}</small>}<h3>{item.title}</h3>{item.outsideObjective && <small className="expense-outside-objective">{tx(language, "Outside objective", "Fuera de objetivo")}</small>}{secondary && <p>{secondary}</p>}{item.amount !== null && <strong>{cash(item.amount, item.currency, language)}</strong>}{purchaseBalance(item) !== null && <small>{tx(language, "Pending", "Pendiente")}: {cash(purchaseBalance(item)!, paymentCurrency, language)}</small>}<div className="expense-chip-row"><span className={!item.budgetLineId ? "muted" : ""}>{item.budgetLineLabel || tx(language, "No budget line", "Sin partida")}</span><span>{item.documentCount} {item.documentCount === 1 ? tx(language, "document", "comprobante") : tx(language, "documents", "comprobantes")}</span></div>{isOwner && <div className="expense-card-actions"><button className="expense-edit" disabled={busy || item.currency !== paymentCurrency} title={item.currency !== paymentCurrency ? tx(language, `Payments are recorded in ${paymentCurrency}; this purchase keeps its original ${item.currency} amount.`, `Los pagos se registran en ${paymentCurrency}; esta compra conserva su monto original en ${item.currency}.`) : undefined} onClick={() => editPayment("", undefined, "", item)}>{tx(language, "Record installment", "Registrar abono")}</button>{purchaseBalance(item) !== null && <button className="expense-edit" disabled={busy || !purchaseBalance(item)} onClick={() => editPayment("", undefined, "", item, true)}>{tx(language, "Pay balance", "Pagar saldo")}</button>}<button className="expense-edit" onClick={() => editPurchase(item)}>{tx(language, "Edit", "Editar")}</button><button className="expense-delete" aria-label={`${tx(language, "Delete", "Eliminar")} ${item.title}`} onClick={() => void remove("purchase", item.id, item.title)}>{tx(language, "Delete", "Eliminar")}</button></div>}</div></article>; }) : <div className="expense-empty"><b>{tx(language, "No purchases found", "No se encontraron compras")}</b><p>{tx(language, "Add a description, amount, photos, or budget line when useful.", "Agregá descripción, monto, fotos o partida cuando te sirva.")}</p></div>}</section>}

    {tab === "documents" && <section className="document-gallery">{documents.length ? documents.map((item) => { const secondary = [item.documentDate, item.vendor, item.reference].filter(Boolean).join(" · "); return <article className="document-card" key={item.id}><button className="document-preview" onClick={() => item.files[0] && openMedia(item.files[0])}>{item.files[0]?.isImage ? <Image unoptimized src={item.files[0].thumbnailUrl || item.files[0].previewUrl} width={360} height={260} alt={item.title} /> : <span>{item.files[0]?.contentType === "application/pdf" ? "PDF" : "DOC"}</span>}{item.files.length > 0 && <i>{item.files.length}</i>}</button><div><span className={`document-type ${item.documentType}`}>{documentLabels(language)[item.documentType]}</span><h3>{item.title}</h3>{item.outsideObjective && <small className="expense-outside-objective">{tx(language, "Outside objective", "Fuera de objetivo")}</small>}{secondary && <p>{secondary}</p>}{item.amount !== null && <strong>{cash(item.amount, item.currency, language)}</strong>}<div className="expense-chip-row">{item.purchaseId && <span>⌂ {item.purchaseTitle}</span>}{(item.budgetLines || []).map((line) => <span key={line.id}>↗ {line.label}</span>)}<span className={receiptUses.get(item.id) ? "" : "muted"}>{receiptUses.get(item.id) ? tx(language, `In ${receiptUses.get(item.id)} ${receiptUses.get(item.id) === 1 ? "payment" : "payments"}`, `En ${receiptUses.get(item.id)} ${receiptUses.get(item.id) === 1 ? "pago" : "pagos"}`) : tx(language, "Pending link", "Pendiente de vincular")}</span></div></div>{isOwner && <div className="expense-card-actions"><button className="expense-edit" disabled={busy} onClick={() => { setError(""); setLinkPaymentQuery(""); setReceiptToLink(item); }}>{tx(language, "Link to payment", "Vincular a pago")}</button><button className="expense-edit" disabled={busy} onClick={() => editPayment("", undefined, item.id)}>{tx(language, "Record payment", "Registrar pago")}</button>{!item.id.startsWith("legacy:") && <><button className="expense-edit" onClick={() => editDocument(item)}>{tx(language, "Edit", "Editar")}</button><button className="expense-delete" disabled={Boolean(receiptUses.get(item.id))} title={receiptUses.get(item.id) ? tx(language, "Unlink it from payments before deleting", "Desvinculalo de sus pagos antes de eliminar") : undefined} aria-label={`${tx(language, "Delete", "Eliminar")} ${item.title}`} onClick={() => void remove("document", item.id, item.title)}>{tx(language, "Delete", "Eliminar")}</button></>}</div>}</article>; }) : <div className="expense-empty"><b>{tx(language, "No documents found", "No se encontraron comprobantes")}</b><p>{tx(language, "Invoices and payroll evidence can exist without a purchase.", "Facturas y planillas pueden existir sin una compra.")}</p></div>}</section>}

    {tab === "payments" && <section className="payment-ledger" aria-label={tx(language, "Payment history", "Historial de pagos")}>
      <p className="payment-unassigned-total">{tx(language, "Unassigned payments", "Pagos sin asignar")}: <strong>{cash(paymentData.payments.filter((item) => (paymentsModelVersion === 2 || item.accountingMode === "ledger") && !item.budgetLineId).reduce((sum, item) => sum + item.amount, 0), paymentCurrency, language)}</strong> · {tx(language, "Not included in a budget line until assigned.", "Se incluyen en una partida cuando los asignés.")}</p>
      <div className="section-heading"><div><h3>{tx(language, "Payments and receipts", "Pagos y comprobantes")}</h3><p>{tx(language, "A payment may have several receipts and no budget line.", "Un pago puede tener varios comprobantes y quedar sin partida.")}</p></div><input type="search" aria-label={tx(language, "Search payments", "Buscar pagos")} value={query} onChange={(event) => setQuery(event.target.value)} /></div>
      {!visiblePayments.length && <div className="expense-empty"><b>{tx(language, "No payments found", "No se encontraron pagos")}</b><p>{tx(language, "Record an installment or a balance payment when money is paid.", "Registrá un abono o una liquidación cuando hagás el pago.")}</p></div>}
      {visiblePayments.map((item) => <article className="payment-item" key={item.id}><div><small>{item.paymentDate}</small><b>{paymentRecordTitle(item, language, item.budgetLineLabel || undefined)}</b><span>{item.budgetLineLabel || tx(language, "Unassigned", "Sin asignar")}{item.purchaseId && purchaseMap.get(item.purchaseId) ? ` · ${purchaseMap.get(item.purchaseId)!.title}` : ""}</span><small>{paymentsModelVersion === 2 || item.accountingMode === "ledger" ? paymentRecordKind(item, language) : tx(language, "Excel history detail · already included", "Detalle histórico de Excel · ya incluido")}</small><div className="payment-receipt-links">{paymentDocumentIds(item).map((id) => { const receipt = documentData.documents.find((document) => document.id === id); return receipt && <button key={id} disabled={!receipt.files[0]} onClick={() => receipt.files[0] && openMedia(receipt.files[0])}>▧ {receipt.title}</button>; })}</div></div><div><strong>{cash(item.amount, paymentCurrency, language)}</strong>{isOwner && <div className="payment-actions"><button className="expense-edit" disabled={busy} onClick={() => editPayment("", item)}>{tx(language, "Edit", "Editar")}</button><button className="expense-delete" disabled={busy} onClick={() => void remove("payment", item.id, item.payee)}>{tx(language, "Delete", "Eliminar")}</button></div>}</div></article>)}
    </section>}
    {tab === "paid" && <section className="paid-ledger">
      <div className="section-heading"><div><h3>{tx(language, "Paid budget lines", "Partidas pagadas")}</h3><p>{tx(language, "Open a budget line only when you need its payments or attachments.", "Abrí una partida solo cuando necesités ver sus pagos o adjuntos.")}</p></div></div>
      <div className="paid-filters">
        <div className="paid-filter-controls">
          <label className="paid-search"><span>{tx(language, "Search", "Buscar")}</span><input type="search" value={paidQuery} onChange={(event) => setPaidQuery(event.target.value)} placeholder={tx(language, "Budget line, category, or vendor…", "Partida, categoría o proveedor…")} /></label>
          <label><span>{tx(language, "Chapter", "Capítulo")}</span><select value={paidChapterFilter} onChange={(event) => setPaidChapterFilter(event.target.value)}><option value="">{tx(language, "All chapters", "Todos los capítulos")}</option>{paidChapters.map((chapter) => <option key={chapter} value={chapter}>{mode === "demo" && chapter === demoLine.chapter ? tx(language, "Finishes", "Acabados") : chapter}</option>)}</select></label>
          <label><span>{tx(language, "Status", "Estado")}</span><select value={paidStatusFilter} onChange={(event) => setPaidStatusFilter(event.target.value as PaidStatusFilter)}><option value="all">{tx(language, "All statuses", "Todos los estados")}</option>{paymentsModelVersion !== 2 && <><option value="needs-detail">{tx(language, "History to review", "Histórico por revisar")}</option><option value="complete">{tx(language, "Historical detail complete", "Detalle histórico completo")}</option></>}<option value="with-files">{tx(language, "With purchases or documents", "Con compras o comprobantes")}</option><option value="without-files">{tx(language, "Without purchases or documents", "Sin compras ni comprobantes")}</option></select></label>
          {hasPaidFilters && <button className="paid-filter-clear" onClick={() => { setPaidQuery(""); setPaidChapterFilter(""); setPaidStatusFilter("all"); }}>{tx(language, "Clear filters", "Limpiar filtros")}</button>}
        </div>
        <p><strong>{filteredPaidExpenses.length}</strong> {tx(language, `of ${paidExpenses.length} budget lines`, `de ${paidExpenses.length} partidas`)}</p>
      </div>
      {!paid ? <div className="editor-loading">{tx(language, "Loading…", "Cargando…")}</div> : filteredPaidExpenses.length ? filteredPaidExpenses.map((line) => <PaidLineCard currency={paymentCurrency} key={line.id} unifiedPayments={paymentsModelVersion === 2} line={line} payments={paymentsByLine.get(line.id) || []} paymentComplete={paymentData.completedLineIds.includes(line.id)} setPaymentComplete={setPaymentComplete} purchases={purchasesByLine.get(line.id) || []} documents={documentsByLine.get(line.id) || []} allPurchases={purchaseData.purchases} allDocuments={documentData.documents} language={language} isOwner={isOwner} busy={busy} cover={cover} setDetail={setDetail} setPreview={openMedia} editPayment={editPayment} removePayment={(item) => remove("payment", item.id, item.payee || tx(language, "Payment", "Pago"))} removePurchase={(item) => remove("purchase", item.id, item.title)} removeDocument={(item) => remove("document", item.id, item.title)} removeLegacyInvoice={removeLegacyInvoice} editPurchase={editPurchase} editDocument={editDocument} quickLink={quickLink} />) : <div className="expense-empty paid-filter-empty"><b>{tx(language, "No budget lines match these filters", "Ninguna partida coincide con estos filtros")}</b><p>{tx(language, "Change or clear the filters to see more results.", "Cambiá o limpiá los filtros para ver más resultados.")}</p></div>}
    </section>}

    {detail && <ExpenseDialog className="detail-backdrop" label={detail.title} onClose={() => setDetail(null)} closeOnBackdrop><section className="purchase-detail"><button className="close" aria-label={tx(language, "Close purchase", "Cerrar compra")} onClick={() => setDetail(null)}>×</button><span className="overline">{tx(language, "PURCHASE", "COMPRA")}</span><h2>{detail.title}</h2>{detail.photos.length ? <div className="purchase-carousel">{detail.photos.map((photo) => <button key={photo.id} onClick={() => openMedia(photo)}><Image unoptimized src={photo.thumbnailUrl || photo.previewUrl} width={600} height={440} alt={photo.name} /></button>)}</div> : <div className="purchase-placeholder">▧ {tx(language, "No product photos", "Sin fotos del producto")}</div>}<dl><dt>{tx(language, "Vendor", "Proveedor")}</dt><dd>{detail.vendor || "—"}</dd><dt>{tx(language, "Date", "Fecha")}</dt><dd>{detail.purchaseDate || "—"}</dd><dt>{tx(language, "Reference", "Referencia")}</dt><dd>{detail.reference || "—"}</dd><dt>{tx(language, "Budget line", "Partida")}</dt><dd>{detail.outsideObjective ? tx(language, "Outside objective", "Fuera de objetivo") : detail.budgetLineLabel || "—"}</dd></dl>{detail.notes && <div className="expense-note"><b>{tx(language, "Notes", "Notas")}</b><p>{detail.notes}</p></div>}<h3>{tx(language, "Related documents", "Comprobantes relacionados")}</h3><div className="linked-document-list">{documentData.documents.filter((item) => item.purchaseId === detail.id || paymentData.payments.some((payment) => payment.purchaseId === detail.id && paymentDocumentIds(payment).includes(item.id))).map((item) => <button key={item.id} onClick={() => item.files[0] && openMedia(item.files[0])}>{documentLabels(language)[item.documentType]} · {item.title}</button>)}</div>{isOwner && <footer><button onClick={() => editPurchase(detail)}>{tx(language, "Edit purchase", "Editar compra")}</button><button disabled={detail.currency !== paymentCurrency} onClick={() => { setDetail(null); editPayment("", undefined, "", detail); }}>{tx(language, "Record installment", "Registrar abono")}</button>{purchaseBalance(detail) !== null && <button disabled={!purchaseBalance(detail)} onClick={() => { setDetail(null); editPayment("", undefined, "", detail, true); }}>{tx(language, "Pay balance", "Pagar saldo")}</button>}<button className="expense-delete" onClick={() => void remove("purchase", detail.id, detail.title)}>{tx(language, "Delete purchase", "Eliminar compra")}</button></footer>}</section></ExpenseDialog>}

    {purchaseDraft && <PurchaseForm draft={purchaseDraft} setDraft={updatePurchaseDraft} lines={paidLines} existing={purchaseDraft.id ? purchaseMap.get(purchaseDraft.id) : undefined} language={language} busy={busy} uploadProgress={uploadProgress} error={error} files={purchaseFiles} setFiles={setPurchaseFiles} photosRef={photosRef} cameraRef={cameraRef} save={savePurchase} remove={() => purchaseDraft.id && void remove("purchase", purchaseDraft.id)} removePhoto={(fileId) => purchaseDraft.id && void removeMedia("photo", purchaseDraft.id, fileId)} />}
    {documentDraft && <DocumentForm draft={documentDraft} setDraft={updateDocumentDraft} lines={paidLines} purchases={purchaseData.purchases} existing={documentDraft.id ? documentData.documents.find((item) => item.id === documentDraft.id) : undefined} language={language} busy={busy} uploadProgress={uploadProgress} error={error} files={documentFiles} setFiles={setDocumentFiles} fileRef={documentsRef} save={saveDocument} remove={() => documentDraft.id && void remove("document", documentDraft.id)} removeFile={(fileId) => documentDraft.id && void removeMedia("document", documentDraft.id, fileId)} />}
    {paymentDraft && <PaymentForm currency={paymentDraft.expectedCurrency} draft={paymentDraft} setDraft={updatePaymentDraft} documents={documentData.documents} lines={paidLines} purchases={purchaseData.purchases} receiptUses={receiptUses} files={paymentFiles} setFiles={setPaymentFiles} uploadProgress={uploadProgress} purchaseBalance={(purchase) => purchaseBalance(purchase, paymentDraft.id)} language={language} busy={busy} error={error} clearError={() => setError("")} save={savePayment} remove={() => paymentDraft.id && void remove("payment", paymentDraft.id)} accountingPayments={mode === "real" ? paymentData.payments : undefined} paymentsModelVersion={paymentsModelVersion} imported={Boolean(paymentDraft.id && paymentData.payments.some((item) => item.id === paymentDraft.id && isExcelImportedPayment(item)))} />}
    {receiptToLink && <ExpenseDialog className="detail-backdrop expense-form-backdrop" label={tx(language, "Link receipt to a payment", "Vincular comprobante a un pago")} onClose={() => setReceiptToLink(null)} busy={busy}><section className="expense-form receipt-payment-picker"><button className="close" aria-label={tx(language, "Close", "Cerrar")} disabled={busy} onClick={() => setReceiptToLink(null)}>×</button><h2>{tx(language, "Link receipt to a payment", "Vincular comprobante a un pago")}</h2><p>{receiptToLink.title}</p><p className="form-help">{tx(language, "Choose a saved payment. Its amount and budget assignment will stay the same.", "Elegí un pago guardado. Su monto y asignación al presupuesto se conservan.")}</p><input type="search" aria-label={tx(language, "Search saved payments", "Buscar pagos guardados")} value={linkPaymentQuery} onChange={(event) => setLinkPaymentQuery(event.target.value)} /><div className="receipt-payment-options">{paymentData.payments.filter((item) => searchKey(`${paymentRecordTitle(item, language)} ${item.payee} ${item.reference} ${item.budgetLineLabel}`).includes(searchKey(linkPaymentQuery))).map((item) => <button key={item.id} disabled={busy || paymentDocumentIds(item).includes(receiptToLink.id)} onClick={() => void linkReceiptToPayment(item)}><span><b>{paymentRecordTitle(item, language)}</b><small>{item.paymentDate} · {item.budgetLineLabel || tx(language, "Unassigned", "Sin asignar")}</small></span><strong>{cash(item.amount, paymentCurrency, language)}</strong>{paymentDocumentIds(item).includes(receiptToLink.id) && <small>{tx(language, "Already linked", "Ya vinculado")}</small>}</button>)}</div>{!paymentData.payments.length && <p>{tx(language, "There are no saved payments yet.", "Aún no hay pagos guardados.")}</p>}<footer><button className="expense-primary" disabled={busy} onClick={() => editPayment("", undefined, receiptToLink.id)}>{tx(language, "Record payment", "Registrar pago")}</button></footer></section></ExpenseDialog>}
    {preview && <MediaPreview media={preview} language={language} close={() => setPreview(null)} />}
  </div>;
}

function PaidLineCard({
  line, payments, paymentComplete, setPaymentComplete, purchases, documents, allPurchases, allDocuments, language, isOwner, busy, cover, unifiedPayments, currency = "CRC",
  setDetail, setPreview, editPayment, removePayment, removePurchase, removeDocument, removeLegacyInvoice, editPurchase, editDocument, quickLink,
}: {
  line: ExpenseRecord;
  unifiedPayments?: boolean;
  currency?: "CRC" | "USD";
  payments: ExpensePaymentRecord[];
  paymentComplete: boolean;
  setPaymentComplete: (budgetLineId: string, complete: boolean) => Promise<void>;
  purchases: PurchaseRecord[];
  documents: ExpenseDocumentRecord[];
  allPurchases: PurchaseRecord[];
  allDocuments: ExpenseDocumentRecord[];
  language: Language;
  isOwner: boolean;
  busy: boolean;
  cover: (item: PurchaseRecord) => ExpenseMedia | undefined;
  setDetail: (item: PurchaseRecord) => void;
  setPreview: (item: ExpenseMedia) => void;
  editPayment: (lineId: string, item?: ExpensePaymentRecord) => void;
  removePayment: (item: ExpensePaymentRecord) => Promise<void>;
  removePurchase: (item: PurchaseRecord) => Promise<void>;
  removeDocument: (item: ExpenseDocumentRecord) => Promise<void>;
  removeLegacyInvoice: (item: ExpenseRecord["attachments"][number]) => Promise<void>;
  editPurchase: (item?: PurchaseRecord, lineId?: string) => void;
  editDocument: (item?: ExpenseDocumentRecord, lineId?: string, purchaseId?: string) => void;
  quickLink: (kind: "purchase" | "document", id: string, budgetLineId: string) => Promise<void>;
}) {
  const detailed = payments.reduce((sum, item) => sum + item.amount, 0);
  const documentCount = documents.length + line.attachments.length;
  return <details className="paid-line">
    <summary className="paid-line-summary">
      <div><small>{line.chapter} · {line.subcategory}</small><h3>{line.description}</h3>{line.outsideObjective && <small className="expense-outside-objective">{tx(language, "Outside objective", "Fuera de objetivo")}</small>}{line.vendor && <p>{line.vendor}</p>}</div>
      <div className="paid-line-summary-meta">
        <div className="paid-line-counts">
          <span className={paymentComplete && !unifiedPayments ? "complete" : ""}>{paymentComplete && !unifiedPayments ? tx(language, "Historical detail complete", "Detalle histórico completo") : `${payments.length} ${payments.length === 1 ? tx(language, "payment", "pago") : tx(language, "payments", "pagos")}`}</span>
          <span>{purchases.length} {purchases.length === 1 ? tx(language, "purchase", "compra") : tx(language, "purchases", "compras")}</span>
          <span>{documentCount} {documentCount === 1 ? tx(language, "document", "comprobante") : tx(language, "documents", "comprobantes")}</span>
        </div>
        <div className="paid-official"><small>{tx(language, "Paid in budget", "Pagado en presupuesto")}</small><strong>{cash(line.amount, currency, language)}</strong></div>
        <i aria-hidden="true">⌄</i>
      </div>
    </summary>
    <div className="paid-line-body">
      <section className="payment-breakdown">
        {!unifiedPayments && <label className="payment-complete-toggle"><input type="checkbox" checked={paymentComplete} disabled={!isOwner || busy} onChange={(event) => void setPaymentComplete(line.id, event.target.checked)} /><span><b>{tx(language, "Historical detail complete", "Detalle histórico completo")}</b><small>{tx(language, "Excel history was already reviewed", "El histórico de Excel ya se revisó")}</small></span></label>}
        {paymentComplete && !unifiedPayments ? <div className="payment-complete-note"><span>{tx(language, "Historical detail is marked complete. Receipt files remain available in Documents and Payments.", "El detalle histórico está marcado como completo. Los comprobantes siguen disponibles en Comprobantes y Pagos.")}</span>{payments.length > 0 && <small>{payments.length} {payments.length === 1 ? tx(language, "saved payment remains hidden", "pago guardado permanece oculto") : tx(language, "saved payments remain hidden", "pagos guardados permanecen ocultos")}</small>}</div> : <>
          <div className="payment-summary"><div><b>{tx(language, "Recorded payments", "Pagos registrados")}</b><small>{payments.length} {payments.length === 1 ? tx(language, "payment", "pago") : tx(language, "payments", "pagos")}</small></div><div><strong>{cash(detailed, currency, language)}</strong></div></div>
          {!unifiedPayments && <p className="payment-excel-note">{tx(language, "The historical Excel amount is already included in the total. These records preserve its detail. Use Record payment above only for a new payment, which increases the total.", "El importe histórico de Excel ya está incluido en el acumulado. Estos registros conservan su detalle. Usá Registrar pago arriba solo para un pago nuevo, que aumenta el acumulado.")}</p>}
          {payments.length > 0 && <div className="payment-list">{payments.map((item) => <article className="payment-item" key={item.id}><div><small>{item.paymentDate || tx(language, "No date", "Sin fecha")}</small><b>{paymentRecordTitle(item, language)}</b><small>{unifiedPayments ? paymentRecordKind(item, language) : item.accountingMode === "ledger" ? tx(language, "New payment · included in total", "Pago nuevo · incluido en el acumulado") : tx(language, "Excel history detail · already included", "Detalle histórico de Excel · ya incluido")}</small>{item.reference && <span>{item.reference}</span>}{item.notes && <p>{item.notes}</p>}{item.documentId && <button onClick={() => { const record = allDocuments.find((document) => document.id === item.documentId); if (record?.files[0]) setPreview(record.files[0]); }}>▧ {item.documentTitle}</button>}</div><div><strong>{cash(item.amount, currency, language)}</strong>{isOwner && <div className="payment-actions"><button className="expense-edit" onClick={() => editPayment(line.id, item)}>{tx(language, "Edit", "Editar")}</button><button className="expense-delete" aria-label={`${tx(language, "Delete", "Eliminar")} ${item.payee || tx(language, "Payment", "Pago")}`} onClick={() => void removePayment(item)}>{tx(language, "Delete", "Eliminar")}</button></div>}</div></article>)}</div>}
        </>}
      </section>

      <div className="paid-links">
        <div><b>{tx(language, "Purchases", "Compras")} · {purchases.length}</b><div className="mini-gallery">{purchases.map((item) => <div className="mini-purchase-item" key={item.id}><button className="mini-purchase-open" onClick={() => setDetail(item)}>{cover(item) ? <Image unoptimized src={cover(item)!.thumbnailUrl || cover(item)!.previewUrl} width={72} height={54} alt={item.title} /> : <span>▧</span>}<small>{item.title}</small></button>{isOwner && <button className="mini-purchase-delete" disabled={busy} aria-label={`${tx(language, "Delete purchase", "Eliminar compra")} ${item.title}`} onClick={() => void removePurchase(item)}>{tx(language, "Delete", "Eliminar")}</button>}</div>)}</div></div>
        <div><b>{tx(language, "Documents", "Comprobantes")} · {documentCount}</b><div className="linked-document-list">{documents.map((item) => <div className="linked-document-item" key={item.id}><button className="linked-document-open" disabled={!item.files[0]} onClick={() => item.files[0] && setPreview(item.files[0])}>{documentLabels(language)[item.documentType]} · {item.title}</button>{isOwner && !item.id.startsWith("legacy:") && <button className="linked-document-delete" disabled={busy} aria-label={`${tx(language, "Delete document", "Eliminar comprobante")} ${item.title}`} onClick={() => void removeDocument(item)}>{tx(language, "Delete", "Eliminar")}</button>}</div>)}{line.attachments.map((file) => <div className="linked-document-item" key={file.id}><a href={`/api/files?id=${encodeURIComponent(file.documentId)}&preview=${file.isImage ? "image" : "pdf"}`} target="_blank" rel="noreferrer" onClick={() => trackUsageInteraction("document.open")}>{file.fileName}</a>{isOwner && <button className="linked-document-delete" disabled={busy} aria-label={`${tx(language, "Delete invoice", "Eliminar factura")} ${file.fileName}`} onClick={() => void removeLegacyInvoice(file)}>{tx(language, "Delete", "Eliminar")}</button>}</div>)}</div></div>
      </div>

      {isOwner && <details className="attach-menu">
        <summary>＋ {tx(language, "Attach", "Adjuntar")}</summary>
        <div>
          <button onClick={() => editPurchase(undefined, line.id)}>＋ {tx(language, "New purchase", "Nueva compra")}</button>
          <button onClick={() => editDocument(undefined, line.id)}>＋ {tx(language, "New document", "Nuevo comprobante")}</button>
          <label>{tx(language, "Existing purchase", "Compra existente")}<select defaultValue="" onChange={(event) => { if (event.target.value) void quickLink("purchase", event.target.value, line.id); event.currentTarget.value = ""; }}><option value="">{tx(language, "Select…", "Seleccionar…")}</option>{allPurchases.filter((item) => !item.budgetLineId).map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
        </div>
      </details>}
    </div>
  </details>;
}

function PaymentForm({ draft, setDraft, documents, lines, purchases, receiptUses, files, setFiles, uploadProgress, purchaseBalance, language, busy, error, clearError, save, remove, lockedBudgetLine, accountingPayments, paymentsModelVersion = 1, imported = false, currency = "CRC" }: {
  draft: PaymentDraft; setDraft: (value: PaymentDraft | null) => void; documents: ExpenseDocumentRecord[]; lines: PaidLine[]; purchases: PurchaseRecord[];
  receiptUses: Map<string, number>; files: File[]; setFiles: (files: File[]) => void; uploadProgress: UploadProgressState | null;
  purchaseBalance: (purchase: PurchaseRecord) => number | null; language: Language; busy: boolean; error: string; clearError: () => void; save: () => void; remove?: () => void;
  lockedBudgetLine?: { id: string; label: string };
  accountingPayments?: ExpensePaymentRecord[];
  paymentsModelVersion?: number;
  imported?: boolean;
  currency?: "CRC" | "USD";
}) {
  const field = (key: keyof PaymentDraft, value: string) => setDraft({ ...draft, [key]: value });
  const fileRef = useRef<HTMLInputElement>(null);
  const decimalAmount = useRef(currency === "USD" || draft.amount.includes("."));
  const changeAmount = (value: string) => {
    decimalAmount.current ||= draft.amount.includes(".");
    const applyAmount = (amount: string) => {
      const purchase = purchases.find((item) => item.id === draft.purchaseId);
      const remaining = purchase ? purchaseBalance(purchase) : null;
      const partial = draft.paymentKind === "settlement" && remaining !== null && Number(amount) > 0 && Number(amount) < remaining;
      setDraft({ ...draft, amount, paymentKind: partial ? "partial" : draft.paymentKind });
    };
    if (decimalAmount.current && /^[\d.]*$/.test(value)) {
      if (/^\d*(?:\.\d{0,2})?$/.test(value)) applyAmount(value);
    } else applyAmount(normalizeCrcAmountInput(value));
  };
  const [showPicker, setShowPicker] = useState(draft.documentIds.length > 0);
  const purchase = purchases.find((item) => item.id === draft.purchaseId);
  const balance = purchase ? purchaseBalance(purchase) : null;
  const amount = Number(draft.amount);
  const accountingEnabled = accountingPayments !== undefined && paymentsModelVersion !== 2;
  const selectedLine = lines.find((line) => line.id === draft.budgetLineId);
  const historyBase = historicalPaymentBase(lines, accountingPayments || [], draft.budgetLineId);
  const historyAvailable = availableHistoricalPayment(lines, accountingPayments || [], draft.budgetLineId, draft.id);
  const previousPayment = accountingPayments?.find((payment) => payment.id === draft.id && payment.budgetLineId === draft.budgetLineId);
  const previousRecordedAmount = previousPayment && (paymentsModelVersion === 2 || previousPayment.accountingMode === "ledger") ? previousPayment.amount : 0;
  const paidAfterSave = selectedLine ? Math.max(0, roundedMoney(selectedLine.paid - previousRecordedAmount + (paymentsModelVersion === 2 || draft.accountingMode === "ledger" ? amount : 0))) : null;
  const toggleReceipt = (id: string) => setDraft({ ...draft, documentIds: draft.documentIds.includes(id) ? draft.documentIds.filter((item) => item !== id) : [...draft.documentIds, id] });
  return <ExpenseDialog className="detail-backdrop expense-form-backdrop" label={tx(language, "Payment", "Pago")} onClose={() => setDraft(null)} busy={busy}><section className="expense-form payment-form receipt-payment-form">
    <button className="close" aria-label={tx(language, "Close payment", "Cerrar pago")} disabled={busy} onClick={() => setDraft(null)}>×</button>
    <span className="overline">{draft.id ? tx(language, "EDIT PAYMENT", "EDITAR PAGO") : tx(language, "NEW PAYMENT", "NUEVO PAGO")}</span><h2>{imported ? tx(language, "Excel payment without details", "Pago de Excel sin detalle") : lockedBudgetLine ? tx(language, "Payment", "Pago") : tx(language, "Record a payment", "Registrar un pago")}</h2>
    <div className="expense-form-fields"><fieldset disabled={busy} className="expense-payment-fields">
      {error && <div className="payment-form-error" role="alert">{error}</div>}
      {lockedBudgetLine && <div className="payment-budget-context"><b>{tx(language, "Budget item", "Partida")}: {lockedBudgetLine.label}</b><p>{paymentsModelVersion === 2 ? draft.id ? tx(language, "Edit this payment and its receipts. The budget will reflect the saved amount.", "Corrige este pago y sus comprobantes. El presupuesto reflejará el monto guardado.") : tx(language, "This new payment increases the paid total. Choose its receipts before saving.", "Este pago nuevo aumenta el total pagado. Elegí sus comprobantes antes de guardar.") : draft.accountingMode === "historical-detail" ? tx(language, "This payment is already included in Excel. Its receipts will not add it to the budget again.", "Este pago ya está incluido en Excel. Sus comprobantes no volverán a sumarlo al presupuesto.") : draft.accountingMode === "ledger" ? tx(language, "This payment will be added to the paid total for this item. Choose receipts here before saving.", "Este pago se sumará a Pagado en esta partida. Podés elegir comprobantes aquí antes de guardar.") : tx(language, "Indicate whether this is a new payment or already included in Excel before saving its receipts.", "Indica si es un pago nuevo o ya incluido en Excel antes de guardar sus comprobantes.")}</p></div>}
      {imported && <p className="form-help">{tx(language, "Complete the date, description and receipts for this payment. Saving edits the same record.", "Completa la fecha, descripción y comprobantes de este pago. Al guardar se modifica el mismo registro.")}</p>}
      <label className="payment-amount-field"><span>{tx(language, "Amount paid", "Monto pagado")} <b>{currency}</b> *</span><div className="payment-amount-input"><span aria-hidden="true">{currency === "USD" ? "$" : "₡"}</span><input autoComplete="off" name={`expense-payment-${currency.toLowerCase()}-amount`} inputMode={currency === "USD" || draft.amount.includes(".") ? "decimal" : "numeric"} placeholder={currency === "USD" ? tx(language, "e.g. 200", "Ej. 200") : tx(language, "e.g. 200000", "Ej. 200000")} value={draft.amount} onChange={(event) => { clearError(); changeAmount(event.target.value); }} /></div>{amount > 0 && <strong>{tx(language, "This payment:", "Este pago:")} {cash(amount, currency, language)}</strong>}</label>
      {accountingEnabled && <><label>{tx(language, "Budget application", "Aplicación al presupuesto")}<select aria-label={tx(language, "Budget application", "Aplicación al presupuesto")} value={draft.accountingMode} onChange={(event) => { clearError(); setDraft({ ...draft, accountingMode: event.target.value as PaymentDraft["accountingMode"] }); }}><option value="" disabled>{tx(language, "Indicate whether this is a new payment or already included in Excel", "Indica si es un pago nuevo o ya incluido en Excel")}</option><option value="ledger">{tx(language, "New payment: add to budget", "Pago nuevo: sumar al presupuesto")}</option><option value="historical-detail" disabled={!draft.budgetLineId || historyBase <= 0}>{tx(language, "Already in Excel: do not add again", "Ya incluido en Excel: no volver a sumar")}</option></select></label>{historyBase > 0 && <small className="form-help">{tx(language, "Excel history available for a payment breakdown", "Histórico de Excel disponible por detallar")}: {cash(historyAvailable, currency, language)}. {tx(language, "It is already included in the budget paid total.", "Ya está incluido en el acumulado pagado del presupuesto.")}</small>}{selectedLine && amount > 0 && draft.accountingMode && <p className="payment-budget-preview">{tx(language, "Paid after saving", "Pagado después de guardar")}: <output aria-label={tx(language, "Paid after saving", "Pagado después de guardar")}>{cash(paidAfterSave!, currency, language)}</output></p>}</>}
      {paymentsModelVersion === 2 && selectedLine && amount > 0 && <p className="payment-budget-preview">{tx(language, "Paid after saving", "Pagado después de guardar")}: <output aria-label={tx(language, "Paid after saving", "Pagado después de guardar")}>{cash(paidAfterSave!, currency, language)}</output></p>}
      <div className="form-pair"><label>{tx(language, "Date", "Fecha")}<input type="date" value={draft.paymentDate} onChange={(event) => field("paymentDate", event.target.value)} /></label><label>{tx(language, "Payment type", "Tipo de pago")}<select value={draft.paymentKind} onChange={(event) => { clearError(); const kind = event.target.value as PaymentDraft["paymentKind"]; setDraft({ ...draft, paymentKind: kind, amount: kind === "settlement" && balance !== null ? String(balance) : draft.amount }); }}><option value="partial">{tx(language, "Installment", "Abono")}</option><option value="settlement">{draft.purchaseId ? tx(language, "Balance payment", "Pago de saldo") : tx(language, "Full payment", "Pago total")}</option></select></label></div>
      {!draft.purchaseId && <small className="form-help">{tx(language, "Without a linked purchase, the amount you enter is used.", "Sin compra vinculada se usa el monto ingresado.")}</small>}
      <label>{tx(language, "Description (optional)", "Descripción (opcional)")}<input value={draft.payee} onChange={(event) => field("payee", event.target.value)} placeholder={tx(language, "Vendor, first installment…", "Proveedor, primer abono…")} /></label>
      <label>{tx(language, "Purchase (optional)", "Compra (opcional)")}<select value={draft.purchaseId} onChange={(event) => { const next = purchases.find((item) => item.id === event.target.value); setDraft({ ...draft, purchaseId: event.target.value, budgetLineId: lockedBudgetLine?.id || next?.budgetLineId || draft.budgetLineId, payee: draft.payee || next?.vendor || "", amount: draft.paymentKind === "settlement" && next && purchaseBalance(next) !== null ? String(purchaseBalance(next)) : draft.amount }); }}><option value="">{tx(language, "Independent payment", "Pago independiente")}</option>{purchases.filter((item) => item.currency === currency && (!lockedBudgetLine || !item.outsideObjective)).map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select>{balance !== null && <small>{tx(language, "Pending for this purchase", "Pendiente de esta compra")}: {cash(balance, currency, language)}</small>}</label>
      {!lockedBudgetLine && <label>{tx(language, "Budget line (optional)", "Partida (opcional)")}<select value={draft.budgetLineId} onChange={(event) => field("budgetLineId", event.target.value)}><option value="">{tx(language, "Unassigned", "Sin asignar")}</option>{lines.map((line) => <option key={line.id} value={line.id}>{line.label}</option>)}</select></label>}
      <div className="payment-form-receipts"><h3>{tx(language, "Receipts (optional)", "Comprobantes (opcional)")}</h3><p>{tx(language, "Choose existing receipts or upload new files. They will support this payment.", "Elegí comprobantes existentes o subí archivos nuevos. Respaldarán este pago.")}</p><div className="expense-main-actions"><button type="button" className="expense-edit" onClick={() => setShowPicker((value) => !value)}>{tx(language, "Choose existing receipts", "Elegir comprobantes existentes")}</button><button type="button" className="expense-edit" onClick={() => fileRef.current?.click()}>{tx(language, "Upload new receipts", "Subir comprobantes nuevos")}</button></div><input ref={fileRef} hidden type="file" accept="image/*,application/pdf" multiple onChange={(event) => { const next = Array.from(event.target.files || []); setFiles([...files, ...next.filter((file) => !files.some((item) => item.name === file.name && item.size === file.size && item.lastModified === file.lastModified))]); event.target.value = ""; }} />
        {(draft.documentIds.length > 0 || files.length > 0) && <ul className="expense-pending-receipts" aria-label={tx(language, "Receipts for this payment", "Comprobantes de este pago")}>{draft.documentIds.map((id) => <li key={id}><span>{documents.find((item) => item.id === id)?.title || tx(language, "Uploaded receipt", "Comprobante subido")}</span><button type="button" aria-label={tx(language, "Remove receipt", "Quitar comprobante")} onClick={() => toggleReceipt(id)}>×</button></li>)}{files.map((file, index) => <li key={`${file.name}-${index}`}><span>{file.name}<small>{tx(language, "New file · uploaded on save", "Archivo nuevo · se sube al guardar")}</small></span><button type="button" aria-label={tx(language, `Remove ${file.name}`, `Quitar ${file.name}`)} onClick={() => setFiles(files.filter((item) => item !== file))}>×</button></li>)}</ul>}
        {showPicker && <ExpenseReceiptPicker documents={documents} selectedIds={draft.documentIds} onToggle={toggleReceipt} language={language} busy={busy} uses={receiptUses} />}
      </div>
      <details className="expense-more-details"><summary>{tx(language, "More optional details", "Más detalles opcionales")}</summary><label>{tx(language, "Transfer / invoice reference", "Referencia de transferencia / factura")}<input value={draft.reference} onChange={(event) => field("reference", event.target.value)} /></label><label>{tx(language, "Payment notes", "Notas del pago")}<textarea value={draft.notes} onChange={(event) => field("notes", event.target.value)} /></label></details>
    </fieldset><UploadProgress progress={uploadProgress} language={language} error={Boolean(error)} fileCount={files.length} /></div>
    <footer><button type="button" className="expense-edit" disabled={busy} onClick={() => setDraft(null)}>{tx(language, "Cancel", "Cancelar")}</button><button className="expense-primary" disabled={busy} onClick={save}>{busy ? tx(language, "Saving…", "Guardando…") : tx(language, "Save payment", "Guardar pago")}</button>{draft.id && remove && <button className="danger-text" disabled={busy} onClick={remove}>{tx(language, "Delete", "Eliminar")}</button>}</footer>
  </section></ExpenseDialog>;
}

function PurchaseForm({ draft, setDraft, lines, existing, language, busy, uploadProgress, error, files, setFiles, photosRef, cameraRef, save, remove, removePhoto }: { draft: PurchaseDraft; setDraft: (value: PurchaseDraft | null) => void; lines: PaidLine[]; existing?: PurchaseRecord; language: Language; busy: boolean; uploadProgress: UploadProgressState | null; error: string; files: File[]; setFiles: (files: File[]) => void; photosRef: React.RefObject<HTMLInputElement | null>; cameraRef: React.RefObject<HTMLInputElement | null>; save: () => void; remove: () => void; removePhoto: (id: string) => void }) {
  const field = (key: keyof PurchaseDraft, value: string) => setDraft({ ...draft, [key]: value });
  return <ExpenseDialog className="detail-backdrop expense-form-backdrop" label={tx(language, "Purchase", "Compra")} onClose={() => setDraft(null)} busy={busy}><section className="expense-form"><button className="close" aria-label={tx(language, "Close purchase", "Cerrar compra")} disabled={busy} onClick={() => setDraft(null)}>×</button><span className="overline">{draft.id ? tx(language, "EDIT PURCHASE", "EDITAR COMPRA") : tx(language, "NEW PURCHASE", "NUEVA COMPRA")}</span><h2>{tx(language, "Purchase", "Compra")}</h2><label>{tx(language, "Description (optional)", "Descripción (opcional)")}<input value={draft.title} placeholder={tx(language, "What did you buy?", "¿Qué compraste?")} onChange={(e) => field("title", e.target.value)} /></label><AmountFields amount={draft.amount} currency={draft.currency} language={language} change={(amount, currency) => setDraft({ ...draft, amount, currency })} /><label>{tx(language, "Budget line (optional)", "Partida (opcional)")}<select value={draft.budgetLineId} onChange={(e) => field("budgetLineId", e.target.value)}><option value="">{tx(language, "No budget line", "Sin partida")}</option><option value="outside-objective">{tx(language, "Outside objective (e.g. gifts)", "Fuera de objetivo (p. ej., regalos)")}</option>{lines.map((line) => <option key={line.id} value={line.id}>{line.label}</option>)}</select></label><div className="media-field"><b>{tx(language, "Product photos (optional)", "Fotos del producto (opcional)")}</b><p>JPEG, PNG, WebP, AVIF · 15 MB</p><input hidden ref={photosRef} type="file" accept="image/jpeg,image/png,image/webp,image/avif" multiple onChange={(e) => setFiles(Array.from(e.target.files || []))} /><input hidden ref={cameraRef} type="file" accept="image/*" capture="environment" onChange={(e) => setFiles([...files, ...Array.from(e.target.files || [])])} /><div><button onClick={() => photosRef.current?.click()}>▧ {tx(language, "Choose photos", "Elegir fotos")}</button><button onClick={() => cameraRef.current?.click()}>◉ {tx(language, "Take photo", "Tomar foto")}</button></div>{files.length > 0 && <small>{files.map((file) => file.name).join(", ")}</small>}</div>{existing?.photos.length ? <div className="cover-picker"><b>{tx(language, "Cover", "Portada")}</b>{existing.photos.map((photo) => <span key={photo.id}><button className={draft.coverPhotoId === photo.id ? "selected" : ""} onClick={() => setDraft({ ...draft, coverPhotoId: photo.id })}><Image unoptimized src={photo.thumbnailUrl || photo.previewUrl} width={90} height={68} alt={photo.name} /></button><button className="media-remove" disabled={busy} onClick={() => removePhoto(photo.id)}>×</button></span>)}</div> : null}<details className="expense-more-details"><summary>{tx(language, "More optional details", "Más detalles opcionales")}</summary><div className="form-pair"><label>{tx(language, "Date", "Fecha")}<input type="date" value={draft.purchaseDate} onChange={(e) => field("purchaseDate", e.target.value)} /></label><label>{tx(language, "Vendor", "Proveedor")}<input value={draft.vendor} onChange={(e) => field("vendor", e.target.value)} /></label></div><label>{tx(language, "Reference / order", "Referencia / orden")}<input value={draft.reference} onChange={(e) => field("reference", e.target.value)} /></label><label>{tx(language, "Notes", "Notas")}<textarea value={draft.notes} onChange={(e) => field("notes", e.target.value)} placeholder={tx(language, "Finish, size, delivery, warranty…", "Acabado, medida, entrega, garantía…")} /></label></details><UploadProgress progress={uploadProgress} language={language} error={Boolean(error)} fileCount={files.length} /><footer><button className="expense-primary" disabled={busy} onClick={save}>{busy ? tx(language, "Saving…", "Guardando…") : tx(language, "Save purchase", "Guardar compra")}</button>{draft.id && <button className="danger-text" disabled={busy} onClick={remove}>{tx(language, "Delete", "Eliminar")}</button>}</footer></section></ExpenseDialog>;
}

function DocumentForm({ draft, setDraft, existing, language, busy, uploadProgress, error, files, setFiles, fileRef, save, remove, removeFile }: { draft: DocumentDraft; setDraft: (value: DocumentDraft | null) => void; lines: PaidLine[]; purchases: PurchaseRecord[]; existing?: ExpenseDocumentRecord; language: Language; busy: boolean; uploadProgress: UploadProgressState | null; error: string; files: File[]; setFiles: (files: File[]) => void; fileRef: React.RefObject<HTMLInputElement | null>; save: () => void; remove: () => void; removeFile: (id: string) => void }) {
  const field = (key: keyof DocumentDraft, value: string) => setDraft({ ...draft, [key]: value });
  return <ExpenseDialog className="detail-backdrop expense-form-backdrop" label={tx(language, "Document", "Comprobante")} onClose={() => setDraft(null)} busy={busy}><section className="expense-form document-upload-form"><button className="close" aria-label={tx(language, "Close document", "Cerrar comprobante")} disabled={busy} onClick={() => setDraft(null)}>×</button><span className="overline">{draft.id ? tx(language, "EDIT DOCUMENT", "EDITAR COMPROBANTE") : tx(language, "UPLOAD RECEIPTS", "SUBIR COMPROBANTES")}</span><h2>{tx(language, "Document", "Comprobante")}</h2><p className="receipt-upload-help">{tx(language, "Upload now and link to a payment later. No amount, installment or budget line is needed; this does not change expenses or Excel.", "Subí ahora y vinculá a un pago después. No hace falta indicar monto, abono ni partida; esto no cambia los gastos ni el Excel.")}</p>
    {error && <p role="alert" className="payment-form-error">{error}</p>}
    <div className="media-field"><b>{tx(language, "Images or PDFs", "Imágenes o PDF")}</b><p>{tx(language, "One or several files · 25 MB each", "Uno o varios archivos · 25 MB cada uno")}</p><input hidden ref={fileRef} type="file" accept="image/*,application/pdf" multiple onChange={(event) => setFiles(Array.from(event.target.files || []))} /><button disabled={busy} onClick={() => fileRef.current?.click()}>＋ {draft.id ? tx(language, "Add files", "Agregar archivos") : tx(language, "Choose files", "Elegir archivos")}</button>{files.length > 0 && <small>{files.map((file) => file.name).join(", ")}</small>}{existing?.files.map((file) => <span className="existing-media" key={file.id}>{file.name}{existing.files.length > 1 && <button disabled={busy} onClick={() => removeFile(file.id)}>×</button>}</span>)}</div>
    <label>{tx(language, "Description (optional)", "Descripción (opcional)")}<input value={draft.title} placeholder={tx(language, "Invoice, receipt, payroll…", "Factura, recibo, planilla…")} onChange={(event) => field("title", event.target.value)} /></label><details className="expense-more-details"><summary>{tx(language, "More optional details", "Más detalles opcionales")}</summary><div className="form-pair"><label>{tx(language, "Type", "Tipo")}<select value={draft.documentType} onChange={(event) => field("documentType", event.target.value)}>{Object.entries(documentLabels(language)).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>{tx(language, "Date", "Fecha")}<input type="date" value={draft.documentDate} onChange={(event) => field("documentDate", event.target.value)} /></label></div><label>{tx(language, "Vendor / payee", "Proveedor / beneficiario")}<input value={draft.vendor} onChange={(event) => field("vendor", event.target.value)} /></label><label>{tx(language, "Invoice / reference number", "Factura / referencia")}<input value={draft.reference} onChange={(event) => field("reference", event.target.value)} /></label><label>{tx(language, "Notes", "Notas")}<textarea value={draft.notes} onChange={(event) => field("notes", event.target.value)} /></label></details><UploadProgress progress={uploadProgress} language={language} error={Boolean(error)} fileCount={files.length} /><footer><button className="expense-primary" disabled={busy} onClick={save}>{busy ? tx(language, "Saving…", "Guardando…") : tx(language, "Save document", "Guardar comprobante")}</button>{draft.id && <button className="danger-text" disabled={busy} onClick={remove}>{tx(language, "Delete", "Eliminar")}</button>}</footer></section></ExpenseDialog>;
}

function AmountFields({ amount, currency, language, change }: { amount: string; currency: "CRC" | "USD"; language: Language; change: (amount: string, currency: "CRC" | "USD") => void }) {
  return <><div className="form-pair"><label>{tx(language, "Amount (optional)", "Monto (opcional)")}<input inputMode="decimal" value={amount} onChange={(e) => change(e.target.value, currency)} /></label><label>{tx(language, "Currency", "Moneda")}<select value={currency} onChange={(e) => change(amount, e.target.value as "CRC" | "USD")}><option>CRC</option><option>USD</option></select></label></div><small className="form-help">{tx(language, "Agreed total for the purchase. Actual payments are recorded separately.", "Total acordado de la compra. Los pagos reales se registran por separado.")}</small></>;
}
