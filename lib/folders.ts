import { FieldValue } from "firebase-admin/firestore";
import { firestore } from "./firebase-admin";
import { FOLDERS, projectScopedId } from "./project";

export type ProjectFolder = {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: string;
  encrypted?: boolean;
};

export const EXPENSE_INVOICE_FOLDER_NAME = "Factura";
export const EXPENSE_PURCHASE_FOLDER_NAME = "Compras";

export function findExpenseInvoiceFolder<T extends Pick<ProjectFolder, "id" | "name" | "parentId"> & { encrypted?: boolean }>(folders: T[]): T | undefined {
  return folders.find((folder) =>
    folder.parentId === null && folder.encrypted !== true &&
    folder.name.trim().toLocaleLowerCase() === EXPENSE_INVOICE_FOLDER_NAME.toLocaleLowerCase(),
  );
}

export function findExpensePurchaseFolder<T extends Pick<ProjectFolder, "id" | "name" | "parentId"> & { encrypted?: boolean }>(folders: T[]): T | undefined {
  return folders.find((folder) =>
    folder.parentId === null && folder.encrypted !== true &&
    folder.name.trim().toLocaleLowerCase() === EXPENSE_PURCHASE_FOLDER_NAME.toLocaleLowerCase(),
  );
}

function iso(value: unknown) {
  return typeof value === "object" && value && "toDate" in value
    ? (value as FirebaseFirestore.Timestamp).toDate().toISOString()
    : new Date(0).toISOString();
}

function serializeFolder(doc: FirebaseFirestore.QueryDocumentSnapshot | FirebaseFirestore.DocumentSnapshot): ProjectFolder {
  const data = doc.data()!;
  return {
    id: doc.id,
    name: String(data.name || "Folder"),
    parentId: typeof data.parentId === "string" && data.parentId ? data.parentId : null,
    createdAt: iso(data.createdAt),
    ...(data.encrypted === true ? { encrypted: true } : {}),
  };
}

export async function listProjectFolders(projectId: string) {
  const snapshot = await firestore.collection(FOLDERS).where("projectId", "==", projectId).get();
  return snapshot.docs.map(serializeFolder);
}

export async function ensureExpenseInvoiceFolder(projectId: string, createdBy: string) {
  const existing = findExpenseInvoiceFolder(await listProjectFolders(projectId));
  if (existing) return existing;
  const ref = firestore.collection(FOLDERS).doc(projectScopedId(projectId, "expense-invoice-folder"));
  const current = await ref.get();
  if (current.exists && current.data()?.projectId === projectId) return serializeFolder(current);
  await ref.set({
    projectId,
    name: EXPENSE_INVOICE_FOLDER_NAME,
    parentId: null,
    createdBy,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return serializeFolder(await ref.get());
}

export async function ensureExpensePurchaseFolder(projectId: string, createdBy: string) {
  const existing = findExpensePurchaseFolder(await listProjectFolders(projectId));
  if (existing) return existing;
  const ref = firestore.collection(FOLDERS).doc(projectScopedId(projectId, "expense-purchase-folder"));
  const current = await ref.get();
  if (current.exists && current.data()?.projectId === projectId) return serializeFolder(current);
  await ref.set({
    projectId,
    name: EXPENSE_PURCHASE_FOLDER_NAME,
    purpose: "expense-purchases",
    parentId: null,
    createdBy,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return serializeFolder(await ref.get());
}

export function buildTopLevelFolderMap(folders: Pick<ProjectFolder, "id" | "parentId">[]) {
  const byId = new Map(folders.map((folder) => [folder.id, folder.parentId ?? null]));
  const resolved = new Map<string, string | null>();

  const resolve = (id: string, trail: Set<string>): string | null => {
    if (resolved.has(id)) return resolved.get(id) ?? null;
    if (trail.has(id)) {
      resolved.set(id, null);
      return null;
    }
    trail.add(id);
    const parentId = byId.get(id);
    if (parentId === undefined) {
      resolved.set(id, null);
      return null;
    }
    if (parentId === null) {
      resolved.set(id, id);
      return id;
    }
    const topLevelId = resolve(parentId, trail);
    resolved.set(id, topLevelId);
    return topLevelId;
  };

  for (const folder of folders) resolve(folder.id, new Set());
  return resolved;
}

export function folderTopLevelId(folderId: string | null | undefined, topLevelMap: Map<string, string | null>) {
  if (!folderId) return null;
  return topLevelMap.get(folderId) ?? null;
}

export function isTopLevelFolder(folder: Pick<ProjectFolder, "parentId">) {
  return folder.parentId === null;
}
