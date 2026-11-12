import { createHash } from "node:crypto";
import { canAccessFolder } from "./auth";
import { firestore } from "./firebase-admin";
import { buildTopLevelFolderMap, findExpenseInvoiceFolder, findExpensePurchaseFolder, folderTopLevelId, listProjectFolders, type ProjectFolder } from "./folders";
import { DOCUMENTS, QUOTE_ANALYSES, projectStoragePrefix, type MemberRecord } from "./project";
import { quoteMime, storedQuoteFiles } from "./quote-context";

export type RagKey = { kind: "document" | "quote"; id: string; index: number };
export type RagSection = "documents" | "expenses" | "quotes";
export type RagSource = {
  key: RagKey;
  section: RagSection;
  folderId: string | null;
  scope: string;
  name: string;
  objectKey: string;
  expenseReceiptId?: string;
  format: "pdf" | "docx" | "image" | "unsupported";
};

const imageTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/avif", "image/gif"]);

export const documentKey = (id: string): RagKey => ({ kind: "document", id, index: 0 });
export const quoteKey = (id: string, index: number): RagKey => ({ kind: "quote", id, index });
export { ragEnabled, ragProjectIds } from "./rag-config";
export const ragJobId = (projectId: string, key: RagKey) => createHash("sha256").update(JSON.stringify([projectId, key.kind, key.id, key.index])).digest("hex");
export const ragScope = (section: RagSection, folderId: string | null) => section === "documents" ? `documents/${folderId ?? ""}` : section;

export function validRagKey(key: RagKey) {
  return (key.kind === "document" || key.kind === "quote") && /^[\w-]{1,160}$/.test(key.id)
    && Number.isInteger(key.index) && key.index >= 0 && key.index < (key.kind === "quote" ? 8 : 1);
}

export function ragSourceRef(key: RagKey) {
  return firestore.collection(key.kind === "quote" ? QUOTE_ANALYSES : DOCUMENTS).doc(key.id);
}

export function ragFolders(folders: ProjectFolder[]) {
  const encrypted = new Set(folders.filter((folder) => folder.encrypted).map((folder) => folder.id));
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const inVault = (folderId: string) => {
    const visited = new Set<string>();
    let id: string | null = folderId;
    while (id && !visited.has(id)) {
      if (encrypted.has(id)) return true;
      visited.add(id);
      id = byId.get(id)?.parentId ?? null;
    }
    return false;
  };
  return {
    topLevels: buildTopLevelFolderMap(folders),
    encrypted: new Set(folders.filter((folder) => inVault(folder.id)).map((folder) => folder.id)),
    invoiceFolderId: findExpenseInvoiceFolder(folders)?.id,
    purchaseFolderId: findExpensePurchaseFolder(folders)?.id,
  };
}

export function resolveRagSource(projectId: string, key: RagKey, data: FirebaseFirestore.DocumentData | undefined, folders: ReturnType<typeof ragFolders>, includeUnsupported = false): RagSource | null {
  if (!data || data.projectId !== projectId || data.deletedAt || data.encrypted || data.encryptionCleanupPending) return null;
  const folderId = key.kind === "document" && typeof data.folderId === "string" && data.folderId ? data.folderId : null;
  const top = folderTopLevelId(folderId, folders.topLevels);
  if (folderId && (!top || folders.encrypted.has(top) || folders.encrypted.has(folderId))) return null;
  if ((top && top === folders.purchaseFolderId) || data.mediaRole === "product_photo") return null;
  if (data.source === "mobile_capture" || data.source === "aesthetics" || data.source === "site_issue") return null;
  const section = key.kind === "quote" ? "quotes" : top && top === folders.invoiceFolderId ? "expenses" : "documents";
  if (key.kind === "document" && (data.fileKind === "purchase" || (data.fileKind !== "invoice" &&
    (data.source === "expense_purchase" || String(data.objectKey ?? "").includes("/purchase-photos/"))))) return null;
  // Expense records must follow the same section boundary as their authenticated download.
  if (section === "documents" && ["expenses", "expense_purchase", "expense_document"].includes(String(data.source))) return null;
  const file = key.kind === "quote" ? storedQuoteFiles(data)[key.index] : {
    name: String(data.fileName ?? ""), contentType: String(data.contentType ?? ""), objectKey: String(data.objectKey ?? ""),
  };
  const prefix = `${projectStoragePrefix(projectId)}/`;
  if (!file?.name || !file.objectKey.startsWith(prefix)) return null;
  const relative = file.objectKey.slice(prefix.length);
  if (relative.split("/").some((part) => !part || part === "." || part === "..")) return null;
  const directory = relative.split("/", 1)[0];
  if (section === "quotes" ? directory !== "quotes" : section === "documents" ? directory !== "documents"
    : !["invoices", "documents", "purchase-photos"].includes(directory)) return null;
  const contentType = file.contentType.toLowerCase();
  const candidate = imageTypes.has(contentType) ? contentType : quoteMime(file.name, contentType);
  const mime = typeof candidate === "string" ? candidate : "";
  const format = mime === "application/pdf" ? "pdf" : mime.includes("wordprocessingml") ? "docx" : imageTypes.has(mime) ? "image" : null;
  if (!format && !includeUnsupported) return null;
  const expenseReceiptId = section === "expenses"
    ? typeof data.expenseDocumentId === "string" && data.expenseDocumentId ? data.expenseDocumentId
      : folderId === folders.invoiceFolderId && data.mediaRole !== "financial_document" ? `legacy:${key.id}` : null
    : null;
  return { key, section, folderId, ...(expenseReceiptId ? { expenseReceiptId } : {}), scope: ragScope(section, folderId), name: file.name, objectKey: file.objectKey, format: format ?? "unsupported" };
}

export function canReadRagSource(actor: MemberRecord, source: RagSource, folders: ReturnType<typeof ragFolders>) {
  return actor.status === "approved" && (actor.role === "admin" || actor.permissions[source.section])
    && (source.section !== "documents" || canAccessFolder(actor, source.folderId, folderTopLevelId(source.folderId, folders.topLevels)));
}

export async function ragFolderState(projectId: string) {
  return ragFolders(await listProjectFolders(projectId));
}
