import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { canAccessFolder, requireTabAccess } from "@/lib/auth";
import { firestore } from "@/lib/firebase-admin";
import { validateFolderMove } from "@/lib/folder-moves";
import { folderDescendantIds } from "@/lib/folder-moves";
import { updateDocumentIndexFolder } from "@/lib/document-index";
import {
  buildTopLevelFolderMap,
  EXPENSE_INVOICE_FOLDER_NAME,
  EXPENSE_PURCHASE_FOLDER_NAME,
  findExpenseInvoiceFolder,
  findExpensePurchaseFolder,
  folderTopLevelId,
  listProjectFolders,
} from "@/lib/folders";
import { DOCUMENTS, FOLDERS } from "@/lib/project";
import { commitActivity } from "@/lib/activity";
import { vaultAccess, vaultRootFolder } from "@/lib/folder-vault";
import { createVault, VaultRecoveryConfigurationError } from "@/lib/folder-vault-crypto";

function cleanName(value: unknown) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, 80) : "";
}

function cleanParentId(value: unknown) {
  return typeof value === "string" && value ? value : null;
}

function serialize(doc: FirebaseFirestore.QueryDocumentSnapshot | FirebaseFirestore.DocumentSnapshot) {
  const data = doc.data()!;
  const createdAt = typeof data.createdAt === "object" && data.createdAt && "toDate" in data.createdAt
    ? (data.createdAt as FirebaseFirestore.Timestamp).toDate().toISOString()
    : new Date(0).toISOString();
  return {
    id: doc.id,
    name: String(data.name || "Folder"),
    parentId: typeof data.parentId === "string" && data.parentId ? data.parentId : null,
    createdAt,
    ...(data.encrypted === true ? { encrypted: true } : {}),
  };
}

export async function GET() {
  const actor = await requireTabAccess("documents");
  if (!actor) return NextResponse.json({ error: "Documents access required" }, { status: 403 });
  const folders = await listProjectFolders(actor.projectId);
  const topLevelMap = buildTopLevelFolderMap(folders);
  const invoiceFolder = findExpenseInvoiceFolder(folders);
  const purchaseFolder = findExpensePurchaseFolder(folders);
  const vaults = await vaultAccess(actor, folders);
  const visible = folders
    .filter((folder) => {
      const top = folderTopLevelId(folder.id, topLevelMap);
      return (!invoiceFolder || top !== invoiceFolder.id) && (!purchaseFolder || top !== purchaseFolder.id);
    })
    .filter((folder) => canAccessFolder(actor, folder.id, folderTopLevelId(folder.id, topLevelMap)))
    .filter((folder) => {
      const root = vaultRootFolder(folders, folder.id);
      if (!root) return true;
      const access = vaults.get(root.id);
      return access?.granted && (folder.id === root.id || Boolean(access.key));
    })
    .map((folder) => folder.encrypted ? { ...folder, unlocked: Boolean(vaults.get(folder.id)?.key), unlockedUntil: vaults.get(folder.id)?.expiresAt ?? null } : folder)
    .sort((a, b) => a.name.localeCompare(b.name));
  return NextResponse.json({ folders: visible }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request) {
  const actor = await requireTabAccess("documents", ["admin", "editor"]);
  if (!actor) return NextResponse.json({ error: "Documents editor access required" }, { status: 403 });
  const body = await request.json() as { name?: unknown; parentId?: unknown; password?: unknown };
  const name = cleanName(body.name);
  const parentId = cleanParentId(body.parentId);
  if (!name) return NextResponse.json({ error: "Folder name is required" }, { status: 400 });
  const encrypted = Object.prototype.hasOwnProperty.call(body, "password");
  if (encrypted && (actor.role !== "admin" || parentId))
    return NextResponse.json({ error: "Only administrators can create encrypted top-level folders" }, { status: 403 });
  if (encrypted && (typeof body.password !== "string" || body.password.length < 12 || body.password.length > 128))
    return NextResponse.json({ error: "Use a password between 12 and 128 characters" }, { status: 400 });
  if (!parentId && [EXPENSE_INVOICE_FOLDER_NAME, EXPENSE_PURCHASE_FOLDER_NAME].some((reserved) => name.toLocaleLowerCase() === reserved.toLocaleLowerCase()))
    return NextResponse.json({ error: "This folder name is reserved for Expenses" }, { status: 409 });

  const folders = await listProjectFolders(actor.projectId);
  if (parentId && !folders.some((folder) => folder.id === parentId))
    return NextResponse.json({ error: "Parent folder not found" }, { status: 404 });
  const parentVault = vaultRootFolder(folders, parentId);
  const parentAccess = parentVault ? (await vaultAccess(actor, folders)).get(parentVault.id) : null;
  if (parentVault && !parentAccess?.key)
    return NextResponse.json({ error: "Unlock the encrypted folder first" }, { status: 423 });
  if (parentId) {
    const parent = folders.find((folder) => folder.id === parentId);
    if (!parent) return NextResponse.json({ error: "Parent folder not found" }, { status: 404 });
    const topLevelMap = buildTopLevelFolderMap(folders);
    const invoiceFolder = findExpenseInvoiceFolder(folders);
    const purchaseFolder = findExpensePurchaseFolder(folders);
    const parentTop = folderTopLevelId(parentId, topLevelMap);
    if ((invoiceFolder && parentTop === invoiceFolder.id) || (purchaseFolder && parentTop === purchaseFolder.id))
      return NextResponse.json({ error: "Expense media folders are managed from Expenses" }, { status: 409 });
    if (!canAccessFolder(actor, parentId, folderTopLevelId(parentId, topLevelMap))) {
      return NextResponse.json({ error: "Folder access required" }, { status: 403 });
    }
  } else if (actor.role !== "admin" && actor.folderAccess.mode !== "all") {
    return NextResponse.json({ error: "All-folder access is required to create top-level folders" }, { status: 403 });
  }

  const duplicate = folders.some((folder) =>
    folder.parentId === parentId && folder.name.toLowerCase() === name.toLowerCase(),
  );
  if (duplicate) return NextResponse.json({ error: "A folder with that name already exists here" }, { status: 409 });

  const ref = firestore.collection(FOLDERS).doc();
  let protection: Awaited<ReturnType<typeof createVault>> | null = null;
  try { protection = encrypted ? await createVault(body.password as string, actor.projectId, ref.id) : null; }
  catch (error) {
    if (error instanceof VaultRecoveryConfigurationError)
      return NextResponse.json({ error: "Folder password recovery is not configured" }, { status: 503 });
    throw error;
  }
  protection?.dataKey.fill(0);
  const record = {
    projectId: actor.projectId,
    name,
    parentId,
    createdBy: actor.email,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    ...(protection ? { encrypted: true, vault: { ...protection.vault, allowedUids: [] } } : {}),
  };
  const visibleTop = parentId ? folderTopLevelId(parentId, buildTopLevelFolderMap(folders)) : ref.id;
  await commitActivity(actor, {
    category: "document", action: "folder.created",
    target: { type: "folder", id: ref.id, label: protection || parentVault ? "Encrypted folder" : name, section: "documents" },
    changes: [{ field: "parent", before: null, after: parentId }],
    visibility: { folderTopLevelId: visibleTop, adminOnly: Boolean(protection || parentVault) },
  }, (transaction) => {
    if (parentVault) transaction.update(firestore.collection(FOLDERS).doc(parentVault.id), { vaultContentUpdatedAt: FieldValue.serverTimestamp() },
      { lastUpdateTime: parentAccess!.revision! });
    transaction.set(ref, record);
  });
  return NextResponse.json({ folder: serialize(await ref.get()) }, { status: 201 });
}

export async function PATCH(request: Request) {
  const actor = await requireTabAccess("documents", ["admin", "editor"]);
  if (!actor) return NextResponse.json({ error: "Documents editor access required" }, { status: 403 });
  const body = await request.json() as { id?: string; name?: unknown; parentId?: unknown };
  if (!body.id) return NextResponse.json({ error: "Folder is required" }, { status: 400 });
  const moving = Object.prototype.hasOwnProperty.call(body, "parentId");
  const name = body.name === undefined ? undefined : cleanName(body.name);
  const parentId = moving ? cleanParentId(body.parentId) : undefined;
  if (!moving && !name) return NextResponse.json({ error: "A new name or parent is required" }, { status: 400 });
  if (moving && parentId === null && actor.role !== "admin" && actor.folderAccess.mode !== "all") {
    return NextResponse.json({ error: "All-folder access is required to move a folder to the top level" }, { status: 403 });
  }
  const ref = firestore.collection(FOLDERS).doc(body.id);
  const snap = await ref.get();
  if (!snap.exists || snap.data()?.projectId !== actor.projectId) return NextResponse.json({ error: "Folder not found" }, { status: 404 });
  const folders = await listProjectFolders(actor.projectId);
  const topLevelMap = buildTopLevelFolderMap(folders);
  if (!canAccessFolder(actor, body.id, folderTopLevelId(body.id, topLevelMap))) {
    return NextResponse.json({ error: "Folder not found" }, { status: 404 });
  }
  const current = folders.find((folder) => folder.id === body.id);
  if (!current) return NextResponse.json({ error: "Folder not found" }, { status: 404 });
  if (moving && parentId && !folders.some((folder) => folder.id === parentId))
    return NextResponse.json({ error: "Destination folder not found" }, { status: 404 });
  const currentVault = vaultRootFolder(folders, current.id);
  const destinationVault = vaultRootFolder(folders, moving ? parentId : current.parentId);
  const currentAccess = currentVault ? (await vaultAccess(actor, folders)).get(currentVault.id) : null;
  if (currentVault && !currentAccess?.key)
    return NextResponse.json({ error: "Unlock the encrypted folder first" }, { status: 423 });
  if (moving && (current.encrypted || currentVault?.id !== destinationVault?.id))
    return NextResponse.json({ error: "Folders cannot be moved across encryption boundaries; move files individually into an unlocked folder" }, { status: 409 });
  const invoiceFolder = findExpenseInvoiceFolder(folders);
  const purchaseFolder = findExpensePurchaseFolder(folders);
  const reservedFolder = [invoiceFolder, purchaseFolder].find((folder) => folder?.id === current.id);
  const targetParentId = moving ? parentId : current.parentId;
  const targetName = name ?? current.name;
  if (targetParentId === null && !reservedFolder &&
    [EXPENSE_INVOICE_FOLDER_NAME, EXPENSE_PURCHASE_FOLDER_NAME].some((reserved) => targetName.toLocaleLowerCase() === reserved.toLocaleLowerCase()))
    return NextResponse.json({ error: "This folder name is reserved for Expenses" }, { status: 409 });
  if (reservedFolder && (moving || (name !== undefined && name.toLocaleLowerCase() !== reservedFolder.name.toLocaleLowerCase()))) {
    return NextResponse.json({ error: "Expense media folders cannot be moved or renamed" }, { status: 409 });
  }
  if (moving && parentId) {
    const parent = folders.find((folder) => folder.id === parentId);
    if (!parent) return NextResponse.json({ error: "Destination folder not found" }, { status: 404 });
    if (!canAccessFolder(actor, parentId, folderTopLevelId(parentId, topLevelMap))) {
      return NextResponse.json({ error: "Folder access required" }, { status: 403 });
    }
    const destinationTop = folderTopLevelId(parentId, topLevelMap);
    if ((invoiceFolder && destinationTop === invoiceFolder.id) || (purchaseFolder && destinationTop === purchaseFolder.id))
      return NextResponse.json({ error: "Expense media folders are managed from Expenses" }, { status: 409 });
  }
  if (moving) {
    const validation = validateFolderMove(folders, body.id, parentId ?? null, {
      allowTopLevelSource: actor.role === "admin",
    });
    if (!validation.ok) {
      const errors = {
        folder_not_found: ["Folder not found", 404],
        destination_not_found: ["Destination folder not found", 404],
        top_level_forbidden: ["Only the owner can move a top-level folder", 403],
        same_parent: ["Folder is already in that location", 409],
        self: ["A folder cannot be moved into itself", 409],
        descendant: ["A folder cannot be moved into its own subfolder", 409],
        duplicate: ["A folder with that name already exists here", 409],
      } as const;
      const [error, status] = errors[validation.reason];
      return NextResponse.json({ error }, { status });
    }
  }
  const duplicate = folders.some((folder) =>
    folder.id !== body.id &&
    folder.parentId === targetParentId &&
    folder.name.toLowerCase() === targetName.toLowerCase(),
  );
  if (duplicate) return NextResponse.json({ error: "A folder with that name already exists here" }, { status: 409 });
  const update: Record<string, unknown> = { updatedBy: actor.email, updatedAt: FieldValue.serverTimestamp() };
  if (moving) update.parentId = parentId;
  if (name) update.name = name;
  const oldTop = folderTopLevelId(current.id, topLevelMap) || current.id;
  const prospectiveFolders = folders.map((folder) => folder.id === current.id ? { ...folder, parentId: moving ? parentId ?? null : folder.parentId } : folder);
  const newTop = folderTopLevelId(current.id, buildTopLevelFolderMap(prospectiveFolders)) || current.id;
  const changes = [
    ...(name && name !== current.name ? [{ field: "name", before: current.name, after: name, format: "text" as const }] : []),
    ...(moving && parentId !== current.parentId ? [{ field: "parent", before: current.parentId, after: parentId ?? null, format: "text" as const }] : []),
  ];
  if (!changes.length) return NextResponse.json({ folder: serialize(snap) });
  await commitActivity(actor, {
    category: "document", action: name && name !== current.name ? "folder.renamed" : "folder.moved",
    target: { type: "folder", id: body.id, label: currentVault ? "Encrypted folder" : name || current.name, section: "documents" }, changes: currentVault ? [] : changes,
    visibility: { folderTopLevelIds: [oldTop, newTop], adminOnly: Boolean(currentVault) },
  }, (transaction) => {
    if (currentVault && currentVault.id !== ref.id) transaction.update(firestore.collection(FOLDERS).doc(currentVault.id), { vaultContentUpdatedAt: FieldValue.serverTimestamp() },
      { lastUpdateTime: currentAccess!.revision! });
    transaction.update(ref, { ...update, ...(currentVault?.id === ref.id ? { vaultContentUpdatedAt: FieldValue.serverTimestamp() } : {}) },
      { lastUpdateTime: currentVault?.id === ref.id ? currentAccess!.revision! : snap.updateTime! });
  });
  if (moving) {
    const affectedFolders = folderDescendantIds(folders, body.id);
    const documents = await firestore.collection(DOCUMENTS).where("projectId", "==", actor.projectId).get();
    await Promise.all(documents.docs
      .filter((document) => !document.data().deletedAt && affectedFolders.has(String(document.data().folderId || "")))
      .map((document) => updateDocumentIndexFolder(actor.projectId, document.id, typeof document.data().folderId === "string" ? document.data().folderId : null)));
  }
  return NextResponse.json({ folder: serialize(await ref.get()) });
}

export async function DELETE(request: Request) {
  const actor = await requireTabAccess("documents", ["admin", "editor"]);
  if (!actor) return NextResponse.json({ error: "Documents editor access required" }, { status: 403 });
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Folder is required" }, { status: 400 });
  const ref = firestore.collection(FOLDERS).doc(id);
  const snap = await ref.get();
  if (!snap.exists || snap.data()?.projectId !== actor.projectId) return NextResponse.json({ error: "Folder not found" }, { status: 404 });
  const folders = await listProjectFolders(actor.projectId);
  const topLevelMap = buildTopLevelFolderMap(folders);
  if (!canAccessFolder(actor, id, folderTopLevelId(id, topLevelMap))) {
    return NextResponse.json({ error: "Folder not found" }, { status: 404 });
  }
  const root = vaultRootFolder(folders, id);
  const access = root ? (await vaultAccess(actor, folders)).get(root.id) : null;
  if (root && !access?.key)
    return NextResponse.json({ error: "Unlock the encrypted folder first" }, { status: 423 });
  if (root?.id === id && actor.role !== "admin")
    return NextResponse.json({ error: "Only administrators can delete encrypted folders" }, { status: 403 });
  if (findExpenseInvoiceFolder(folders)?.id === id || findExpensePurchaseFolder(folders)?.id === id) {
    return NextResponse.json({ error: "Expense media folders cannot be deleted" }, { status: 409 });
  }
  if (folders.some((folder) => folder.parentId === id)) {
    return NextResponse.json({ error: "Folder contains subfolders" }, { status: 409 });
  }
  const documents = await firestore.collection(DOCUMENTS).where("projectId", "==", actor.projectId).get();
  if (documents.docs.some((doc) => doc.data().folderId === id && (!doc.data().deletedAt || Boolean(root)))) {
    return NextResponse.json({ error: "Folder is not empty" }, { status: 409 });
  }
  const current = folders.find((folder) => folder.id === id)!;
  await commitActivity(actor, {
    category: "document", action: "folder.deleted",
    target: { type: "folder", id, label: root ? "Encrypted folder" : current.name, section: "documents", exists: false },
    changes: [{ field: "deleted", before: false, after: true, format: "status" }],
    visibility: { folderTopLevelId: folderTopLevelId(id, topLevelMap) || id, adminOnly: Boolean(root) },
  }, (transaction) => {
    if (root && root.id !== id) transaction.update(firestore.collection(FOLDERS).doc(root.id), { vaultContentUpdatedAt: FieldValue.serverTimestamp() },
      { lastUpdateTime: access!.revision! });
    transaction.delete(ref, { lastUpdateTime: snap.updateTime! });
  });
  return NextResponse.json({ ok: true });
}
