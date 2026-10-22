import { projectCurrency, type ProjectCurrency } from "./currency";

export const EXPENSE_DOCUMENT_TYPES = ["invoice", "receipt", "payroll", "other"] as const;
export type ExpenseDocumentType = (typeof EXPENSE_DOCUMENT_TYPES)[number];
export const EXPENSE_CURRENCIES = ["CRC", "USD"] as const;
export type ExpenseCurrency = ProjectCurrency;

export type ExpenseMedia = {
  id: string;
  name: string;
  contentType: string;
  size: number;
  createdAt: string;
  isImage: boolean;
  thumbnailUrl: string | null;
  previewUrl: string;
};

export type PurchaseRecord = {
  outsideObjective?: boolean;
  id: string;
  title: string;
  purchaseDate: string;
  vendor: string;
  reference: string;
  notes: string;
  amount: number | null;
  currency: ExpenseCurrency;
  budgetLineId: string | null;
  budgetLineLabel: string;
  coverPhotoId: string | null;
  photos: ExpenseMedia[];
  documentCount: number;
  createdAt: string;
  updatedAt: string;
};

export type ExpenseDocumentRecord = {
  paymentIds?: string[];
  paymentCount?: number;
  outsideObjective?: boolean;
  id: string;
  title: string;
  documentType: ExpenseDocumentType;
  documentDate: string;
  vendor: string;
  reference: string;
  notes: string;
  amount: number | null;
  currency: ExpenseCurrency;
  purchaseId: string | null;
  purchaseTitle: string;
  budgetLineIds: string[];
  budgetLines: Array<{ id: string; label: string }>;
  /** @deprecated Use budgetLineIds. Kept for existing clients and stored records. */
  budgetLineId: string | null;
  /** @deprecated Use budgetLines. Kept for existing clients and stored records. */
  budgetLineLabel: string;
  files: ExpenseMedia[];
  createdAt: string;
  updatedAt: string;
};

export type ExpensePaymentRecord = {
  id: string;
  /** Missing currency denotes a legacy CRC payment. */
  currency?: ProjectCurrency;
  source?: "user" | "excel-import";
  sourceLabel?: string;
  budgetLineId: string | null;
  purchaseId?: string | null;
  purchaseTitle?: string;
  paymentKind?: "partial" | "settlement";
  /** Missing mode denotes historical detail already included in the workbook. */
  accountingMode?: "ledger" | "historical-detail";
  documentIds?: string[];
  documents?: Array<{ id: string; title: string; documentType: ExpenseDocumentType }>;
  budgetLineLabel: string;
  amount: number;
  paymentDate: string;
  payee: string;
  reference: string;
  notes: string;
  documentId: string | null;
  documentTitle: string;
  documentType: ExpenseDocumentType | null;
  createdAt: string;
  updatedAt: string;
};

export function cleanExpenseText(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, max) : "";
}

export function cleanExpenseNotes(value: unknown, max = 4_000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export function cleanExpenseDate(value: unknown) {
  const date = typeof value === "string" ? value.trim() : "";
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T00:00:00Z`) : null;
  return parsed && Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date ? date : "";
}

export function expensePaymentDocumentIds(record: { documentIds?: unknown; documentId?: unknown }) {
  const values = Array.isArray(record.documentIds) ? record.documentIds : [record.documentId];
  return [...new Set(values.flatMap((value) => typeof value === "string" && value.trim() ? [value.trim().slice(0, 200)] : []))].slice(0, 50);
}

export type BudgetPaymentInput = { id?: string; deletedAt?: unknown; accountingMode?: unknown; budgetLineId?: unknown; amount?: unknown; currency?: unknown };

/** Legacy payment details describe the workbook's historical amount and are never added again. */
export function applyExpensePaymentsToBudget<T extends { id: string; paid: number; quote: number; objective: number; outsideObjective?: boolean }>(lines: T[], payments: BudgetPaymentInput[], options: { paymentsModelVersion?: number; currency?: ProjectCurrency } = {}) {
  const unified = options.paymentsModelVersion === 2;
  const amounts = new Map<string, number>();
  const currency = options.currency || "CRC";
  const lineIds = new Set(lines.map((line) => line.id));
  for (const payment of payments) {
    if (payment.deletedAt || !unified && payment.accountingMode !== "ledger" || typeof payment.budgetLineId !== "string" || !Number.isFinite(payment.amount) || Number(payment.amount) <= 0) continue;
    if (lineIds.has(payment.budgetLineId) && projectCurrency(payment.currency) !== currency) throw new Error("Payment currency does not match project currency");
    amounts.set(payment.budgetLineId, (amounts.get(payment.budgetLineId) || 0) + Number(payment.amount));
  }
  return lines.map((line) => {
    const transactionPaid = Math.round((amounts.get(line.id) || 0) * 100) / 100;
    const paid = Math.round(((unified ? 0 : line.paid) + transactionPaid) * 100) / 100;
    const remaining = line.quote > 0 ? Math.max(0, Math.round((line.quote - paid) * 100) / 100) : null;
    const paymentStatus: "overpaid" | "paid" | "partial" | "unpaid" | "unknown" = line.quote > 0 ? paid > line.quote ? "overpaid" : paid === line.quote ? "paid" : paid > 0 ? "partial" : "unpaid" : "unknown";
    return { ...line, workbookPaid: unified ? 0 : line.paid, transactionPaid, paid, remaining, paymentStatus,
      excess: line.outsideObjective ? 0 : Math.max(0, Math.max(line.quote, paid) - line.objective) };
  });
}

export function cleanExpenseAmount(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 1_000_000_000_000 ? Math.round(number * 100) / 100 : null;
}

export function cleanExpenseCurrency(value: unknown): ExpenseCurrency {
  return value === "USD" ? "USD" : "CRC";
}

export function cleanExpenseDocumentType(value: unknown): ExpenseDocumentType {
  return EXPENSE_DOCUMENT_TYPES.includes(value as ExpenseDocumentType) ? value as ExpenseDocumentType : "invoice";
}

export function cleanExpenseBudgetLineIds(value: unknown, legacyValue?: unknown) {
  const values = Array.isArray(value) ? value.length ? value : [legacyValue] : value === undefined ? [legacyValue] : [value];
  return [...new Set(values.flatMap((item) => typeof item === "string" && item.trim() ? [item.trim().slice(0, 200)] : []))].slice(0, 50);
}

export function expenseLinksConflict(purchaseBudgetLineId: string | null, documentBudgetLineIds: readonly string[]) {
  return Boolean(purchaseBudgetLineId && documentBudgetLineIds.length && !documentBudgetLineIds.includes(purchaseBudgetLineId));
}

/** Purchase amounts are informational; keep currencies separate and never add document amounts again. */
export function summarizeOutsideObjectivePurchases(records: Array<{ outsideObjective?: unknown; deletedAt?: unknown; budgetLineId?: unknown; amount?: unknown; currency?: unknown }>) {
  const summary = { CRC: 0, USD: 0, count: 0, unpricedCount: 0 };
  for (const record of records) {
    if (record.outsideObjective !== true || record.deletedAt || record.budgetLineId) continue;
    summary.count++;
    if (typeof record.amount !== "number" || !Number.isFinite(record.amount) || record.amount < 0) { summary.unpricedCount++; continue; }
    summary[record.currency === "USD" ? "USD" : "CRC"] += record.amount;
  }
  return summary;
}
