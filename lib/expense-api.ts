import { firestore } from "./firebase-admin";
import { budgetPayload } from "./workbook-store";
import { DOCUMENTS } from "./project";
import type { ExpenseDocumentRecord, ExpenseMedia } from "./expense-records";
import { findExpenseInvoiceFolder, listProjectFolders } from "./folders";

export function expenseIso(value: unknown) {
  return value && typeof value === "object" && "toDate" in value
    ? (value as FirebaseFirestore.Timestamp).toDate().toISOString()
    : "";
}

export async function paidBudgetLines(projectId: string) {
  const budget = await budgetPayload(projectId, { skipGoogleSync: true });
  return budget.lines.filter((line) => line.paid > 0).map((line) => ({
    id: line.id,
    label: line.item,
    chapter: line.chapter,
    supplier: line.supplier,
    paid: line.paid,
  }));
}

export async function expenseBudgetLines(projectId: string) {
  const budget = await budgetPayload(projectId, { skipGoogleSync: true });
  return budget.lines.map((line) => ({ id: line.id, label: line.item, chapter: line.chapter, supplier: line.supplier, paid: line.paid }));
}

export async function validateExpenseBudgetLine(projectId: string, id: string | null) {
  if (!id) return null;
  const budget = await budgetPayload(projectId, { skipGoogleSync: true });
  const line = budget.lines.find((item) => item.id === id);
  return line ? { id: line.id, label: line.item, chapter: line.chapter, supplier: line.supplier, paid: line.paid,
    // budgetPayload retains the official workbook's historical amount separately
    // from ledger payments. Historical detail may allocate only that source amount.
    currency: budget.currency, workbookPaid: line.workbookPaid, planVersion: budget.planVersion, actualsRevision: budget.actualsRevision,
    ...(budget.paymentsModelVersion === 2 ? { paymentsModelVersion: 2, paymentLedgerRevision: budget.paymentLedgerRevision } : {}) } : null;
}

export async function validatePaidBudgetLine(projectId: string, id: string | null) {
  if (!id) return null;
  const lines = await paidBudgetLines(projectId);
  return lines.find((line) => line.id === id) || null;
}

export function mediaJson(document: FirebaseFirestore.QueryDocumentSnapshot | FirebaseFirestore.DocumentSnapshot): ExpenseMedia {
  const data = document.data()!;
  const contentType = String(data.contentType || "application/octet-stream");
  const isImage = contentType.startsWith("image/");
  return {
    id: document.id,
    name: String(data.fileName || "Archivo"),
    contentType,
    size: Number(data.size || 0),
    createdAt: expenseIso(data.createdAt),
    isImage,
    thumbnailUrl: isImage ? `/api/files?id=${encodeURIComponent(document.id)}&preview=thumb` : null,
    previewUrl: `/api/files?id=${encodeURIComponent(document.id)}&preview=${isImage ? "image" : "pdf"}`,
  };
}

export async function projectMedia(projectId: string) {
  const snapshot = await firestore.collection(DOCUMENTS).where("projectId", "==", projectId).get();
  return snapshot.docs.filter((item) => !item.data().deletedAt);
}

/** Read existing invoice files without copying them or inventing a payment. */
export async function legacyExpenseDocuments(projectId: string, media?: Awaited<ReturnType<typeof projectMedia>>): Promise<ExpenseDocumentRecord[]> {
  const [files, folders] = await Promise.all([media || projectMedia(projectId), listProjectFolders(projectId)]);
  const invoiceFolder = findExpenseInvoiceFolder(folders);
  if (!invoiceFolder) return [];
  return files.flatMap((file) => {
    const data = file.data();
    if (data.projectId !== projectId || data.deletedAt || data.folderId !== invoiceFolder.id || data.expenseDocumentId || data.mediaRole === "financial_document" || data.source === "expense_purchase" || !/^(image\/|application\/pdf$)/.test(String(data.contentType || ""))) return [];
    return [{ id: `legacy:${file.id}`, title: String(data.fileName || "Comprobante"), documentType: "receipt" as const,
      documentDate: "", vendor: "", reference: "", notes: "", amount: null, currency: "CRC" as const,
      purchaseId: null, purchaseTitle: "", budgetLineIds: [], budgetLines: [], budgetLineId: null, budgetLineLabel: "",
      files: [mediaJson(file)], createdAt: expenseIso(data.createdAt), updatedAt: expenseIso(data.updatedAt) }];
  });
}
