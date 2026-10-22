import { canAccessFolder } from "./auth";
import { firestore, projectBucket } from "./firebase-admin";
import { buildTopLevelFolderMap, findExpenseInvoiceFolder, findExpensePurchaseFolder, folderTopLevelId, listProjectFolders } from "./folders";
import { DOCUMENTS, type MemberRecord } from "./project";
import { budgetPayload } from "./workbook-store";
import type { QuoteInputFile } from "./quote-analysis";

export const QUOTE_MIME = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
} as const;

export function quoteMime(fileName: string, supplied = "") {
  const extension = fileName.toLowerCase().split(".").pop() as keyof typeof QUOTE_MIME;
  return QUOTE_MIME[extension] || (Object.values(QUOTE_MIME).includes(supplied.toLowerCase() as never) ? supplied.toLowerCase() : "");
}

export function isQuoteDocument(fileName: unknown, contentType: unknown) {
  return Boolean(quoteMime(String(fileName || ""), String(contentType || "")));
}

export function isQuoteReferenceEnabled(data: Record<string, unknown> | undefined) {
  return data?.encrypted !== true && data?.quoteReferenceEnabled === true;
}

export type StoredQuoteFile = { name: string; contentType: string; objectKey: string; size: number; supplier?: string };

export function storedQuoteFiles(data: Record<string, unknown> | undefined): StoredQuoteFile[] {
  const stored = Array.isArray(data?.files) ? data.files.flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const item = value as Record<string, unknown>;
    const name = String(item.fileName || item.name || "").trim();
    const contentType = quoteMime(name, String(item.contentType || ""));
    const objectKey = String(item.objectKey || "");
    return name && contentType && objectKey ? [{ name, contentType, objectKey, size: Math.max(0, Number(item.size || 0)), ...(typeof item.supplier === "string" ? { supplier: item.supplier } : {}) }] : [];
  }).slice(0, 8) : [];
  if (stored.length) return stored;
  const name = String(data?.fileName || "").trim();
  const contentType = quoteMime(name, String(data?.contentType || ""));
  const objectKey = String(data?.objectKey || "");
  return name && contentType && objectKey ? [{ name, contentType, objectKey, size: Math.max(0, Number(data?.size || 0)) }] : [];
}

export function storedQuoteLabel(data: Record<string, unknown> | undefined) {
  const files = storedQuoteFiles(data);
  return files.length > 1 ? `${files[0].name} +${files.length - 1}` : files[0]?.name || "Quote";
}

export async function loadStoredQuoteInputs(data: Record<string, unknown> | undefined) {
  const files = storedQuoteFiles(data);
  return Promise.all(files.map(async (stored): Promise<QuoteInputFile> => {
    const input: QuoteInputFile = { name: stored.name, contentType: stored.contentType, objectKey: stored.objectKey, supplier: stored.supplier || storedQuoteLabel(data) };
    if (stored.contentType.includes("wordprocessingml")) {
      if (!projectBucket) throw new Error("storage_not_configured");
      [input.bytes] = await projectBucket.file(stored.objectKey).download();
    }
    return input;
  }));
}

export async function quoteBudgetContext(projectId: string, allowed: boolean) {
  if (!allowed) return "The member cannot access the official budget.";
  const budget = await budgetPayload(projectId);
  return JSON.stringify({
    currency: budget.currency,
    totals: { objective: budget.objective, quoted: budget.lines.reduce((sum, line) => sum + line.quote, 0), spent: budget.spent, remaining: budget.remaining },
    lines: budget.lines.map(({ id, chapter, item, type, subcategory, objective, quote, paid, supplier, status }) => ({ id, chapter, item, type, subcategory, objective, quote, paid, supplier, status })),
  }).slice(0, 900_000);
}

export async function permittedReferenceDocuments(actor: MemberRecord) {
  if (actor.role !== "admin" && !actor.permissions.documents) return [];
  const [snapshot, folders] = await Promise.all([
    firestore.collection(DOCUMENTS).where("projectId", "==", actor.projectId).get(),
    listProjectFolders(actor.projectId),
  ]);
  const topLevelMap = buildTopLevelFolderMap(folders);
  const invoiceFolder = findExpenseInvoiceFolder(folders);
  const purchaseFolder = findExpensePurchaseFolder(folders);
  return snapshot.docs.filter((document) => {
    const data = document.data();
    const folderId = typeof data.folderId === "string" ? data.folderId : null;
    const topLevelId = folderTopLevelId(folderId, topLevelMap);
    return !data.deletedAt && isQuoteReferenceEnabled(data) && isQuoteDocument(data.fileName, data.contentType)
      && !folders.some((folder) => folder.id === topLevelId && folder.encrypted === true)
      && (!invoiceFolder || topLevelId !== invoiceFolder.id)
      && (!purchaseFolder || topLevelId !== purchaseFolder.id)
      && canAccessFolder(actor, folderId, topLevelId);
  });
}

export async function loadReferenceInputs(actor: MemberRecord, ids: string[]) {
  const permitted = new Map((await permittedReferenceDocuments(actor)).map((document) => [document.id, document]));
  const selected = [...new Set(ids)].slice(0, 8).map((id) => permitted.get(id)).filter((document): document is FirebaseFirestore.QueryDocumentSnapshot => Boolean(document));
  if (selected.length !== [...new Set(ids)].slice(0, 8).length) throw new Error("reference_not_found");
  return Promise.all(selected.map(async (document): Promise<QuoteInputFile & { id: string }> => {
    const data = document.data();
    const contentType = quoteMime(String(data.fileName || ""), String(data.contentType || ""));
    const file: QuoteInputFile & { id: string } = { id: document.id, name: String(data.fileName || "Reference"), contentType, objectKey: String(data.objectKey || "") };
    if (contentType.includes("wordprocessingml")) {
      if (!projectBucket) throw new Error("storage_not_configured");
      [file.bytes] = await projectBucket.file(file.objectKey).download();
    }
    return file;
  }));
}
