import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import mammoth from "mammoth";
import sanitizeHtml from "sanitize-html";
import sharp from "sharp";
import { canAccessFolder, getSessionMember, requireTabAccess } from "@/lib/auth";
import { commitActivity } from "@/lib/activity";
import { firestore, projectBucket } from "@/lib/firebase-admin";
import { buildTopLevelFolderMap, findExpenseInvoiceFolder, findExpensePurchaseFolder, folderTopLevelId, listProjectFolders } from "@/lib/folders";
import { CONFIG, DOCUMENTS, FOLDERS, projectConfigDoc, projectStoragePrefix } from "@/lib/project";
import { indexDocumentBytes, removeDocumentIndex, updateDocumentIndexFolder } from "@/lib/document-index";
import { isQuoteDocument } from "@/lib/quote-context";
import { randomUUID } from "node:crypto";
import { vaultAccess, vaultRootFolder } from "@/lib/folder-vault";
import { decryptVaultBytes, encryptVaultBytes } from "@/lib/folder-vault-crypto";
import { openVaultDocument, sealVaultDocument, vaultDocumentContext } from "@/lib/vault-documents";
import { loadProjectAuthorDisplay } from "@/lib/project-authors";

const PREVIEWABLE_IMAGES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]);
const PDF_TYPE = "application/pdf";
const DOCX_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PREVIEWABLE_AUDIO = new Set(["audio/webm", "audio/mp4", "audio/mpeg", "audio/ogg", "audio/wav", "audio/x-wav"]);

function isPreviewableImage(contentType: unknown) {
  return typeof contentType === "string" && PREVIEWABLE_IMAGES.has(contentType.toLowerCase());
}

function previewKind(fileName: unknown, contentType: unknown) {
  const name = String(fileName || "").toLowerCase();
  const type = String(contentType || "").toLowerCase();
  if (isPreviewableImage(type)) return "image" as const;
  if (type === PDF_TYPE || name.endsWith(".pdf")) return "pdf" as const;
  if (type === DOCX_TYPE || name.endsWith(".docx")) return "docx" as const;
  if (PREVIEWABLE_AUDIO.has(type)) return "audio" as const;
  return null;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[character]!);
}

async function renderDocx(bytes: Buffer, fileName: string) {
  const result = await mammoth.convertToHtml(
    { buffer: bytes },
    { convertImage: mammoth.images.dataUri, externalFileAccess: false },
  );
  const content = sanitizeHtml(result.value, {
    allowedTags: [
      ...sanitizeHtml.defaults.allowedTags,
      "img", "figure", "figcaption", "table", "thead", "tbody", "tfoot", "tr", "th", "td",
    ],
    allowedAttributes: {
      a: ["href", "name", "target", "rel"],
      img: ["src", "alt", "width", "height"],
      td: ["colspan", "rowspan"],
      th: ["colspan", "rowspan", "scope"],
    },
    allowedSchemes: ["http", "https", "mailto", "data"],
    allowProtocolRelative: false,
    transformTags: {
      a: (_tagName, attributes) => ({
        tagName: "a",
        attribs: { ...attributes, target: "_blank", rel: "noopener noreferrer" },
      }),
    },
  });
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(fileName)}</title><style>html{background:#ececf1}body{box-sizing:border-box;max-width:900px;min-height:100vh;margin:0 auto;padding:54px 64px;background:#fff;color:#202127;font:15px/1.65 Arial,sans-serif;box-shadow:0 0 30px #1b1c2117}h1,h2,h3{line-height:1.25;color:#17181c}img{max-width:100%;height:auto}table{width:100%;border-collapse:collapse;margin:20px 0}td,th{padding:8px;border:1px solid #dfe0e5;text-align:left}a{color:#5364d8}@media(max-width:700px){body{padding:28px 22px}}</style></head><body>${content}</body></html>`;
}

async function createThumbnail(bytes: Buffer) {
  return sharp(bytes, { limitInputPixels: 50_000_000 }).rotate().resize(420, 320, { fit: "inside", withoutEnlargement: true }).webp({ quality: 78 }).toBuffer();
}

function iso(value: unknown) {
  return typeof value === "object" && value && "toDate" in value
    ? (value as FirebaseFirestore.Timestamp).toDate().toISOString()
    : new Date(0).toISOString();
}

async function finishVaultMigration(ref: FirebaseFirestore.DocumentReference, data: FirebaseFirestore.DocumentData, projectId: string) {
  if (data.encryptionCleanupPending !== true) return true;
  const keys = data.encryptionCleanupKeys;
  const prefix = projectStoragePrefix(projectId);
  if (!projectBucket || !Array.isArray(keys) || !keys.length || keys.some((key) => typeof key !== "string" ||
    (!key.startsWith(`${prefix}/documents/`) && !key.startsWith(`${prefix}/thumbnails/`)))) return false;
  try {
    await Promise.all(keys.map((key: string) => projectBucket!.file(key).delete({ ignoreNotFound: true })));
    await ref.update({ encryptionCleanupPending: false, encryptionCleanupKeys: FieldValue.delete() });
    return true;
  } catch {
    return false;
  }
}

export async function GET(request: Request) {
  const actor = await getSessionMember();
  if (!actor || actor.status !== "approved") return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const folders = await listProjectFolders(actor.projectId);
  const topLevelMap = buildTopLevelFolderMap(folders);
  const invoiceFolder = findExpenseInvoiceFolder(folders);
  const purchaseFolder = findExpensePurchaseFolder(folders);
  const vaults = await vaultAccess(actor, folders);
  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  if (id) {
    if (!projectBucket) return NextResponse.json({ error: "Storage is unavailable" }, { status: 503 });
    const snap = await firestore.collection(DOCUMENTS).doc(id).get();
    if (!snap.exists || snap.data()?.projectId !== actor.projectId) return NextResponse.json({ error: "Document not found" }, { status: 404 });
    let data = snap.data()!;
    if (data.deletedAt) return NextResponse.json({ error: "Document not found" }, { status: 404 });
    const documentFolderId = typeof data.folderId === "string" ? data.folderId : null;
    const documentTopLevelId = folderTopLevelId(documentFolderId, topLevelMap);
    const isExpenseMedia = Boolean((invoiceFolder && documentTopLevelId === invoiceFolder.id) || (purchaseFolder && documentTopLevelId === purchaseFolder.id));
    const sectionAllowed = actor.role === "admin" || (isExpenseMedia ? actor.permissions.expenses : actor.permissions.documents);
    if (!sectionAllowed || (!isExpenseMedia && !canAccessFolder(actor, documentFolderId, documentTopLevelId)))
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    const root = vaultRootFolder(folders, documentFolderId);
    const key = root ? vaults.get(root.id)?.key : null;
    if (root && !vaults.get(root.id)?.granted) return NextResponse.json({ error: "Document not found" }, { status: 404 });
    if (root && !key) return NextResponse.json({ error: "Unlock the encrypted folder first" }, { status: 423 });
    if ((root && (data.encrypted !== true || data.vaultFolderId !== root.id)) || (!root && data.encrypted === true))
      return NextResponse.json({ error: "Document encryption is inconsistent" }, { status: 409 });
    if (root && !(await finishVaultMigration(snap.ref, data, actor.projectId)))
      return NextResponse.json({ error: "Encryption cleanup is pending. Refresh the folder to retry" }, { status: 503 });
    if (key) data = openVaultDocument(data, key, actor.projectId, snap.id);
    const readBytes = async () => {
      const [stored] = await projectBucket!.file(String(data.objectKey)).download();
      return key ? decryptVaultBytes(stored, key, vaultDocumentContext(actor.projectId, snap.id, "content")) : stored;
    };
    const preview = url.searchParams.get("preview");
    const kind = previewKind(data.fileName, data.contentType);
    if (preview && !kind) return NextResponse.json({ error: "Preview is unavailable" }, { status: 400 });
    if (preview === "thumb") {
      if (kind !== "image") return NextResponse.json({ error: "Thumbnail is unavailable" }, { status: 400 });
      if (key) {
        const thumbnail = await createThumbnail(await readBytes());
        return new Response(new Uint8Array(thumbnail), { headers: { "Content-Type": "image/webp", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
      }
      const thumbnailObjectKey = typeof data.thumbnailObjectKey === "string" ? data.thumbnailObjectKey : "";
      let thumbnailBytes: Buffer;
      if (thumbnailObjectKey) {
        [thumbnailBytes] = await projectBucket.file(thumbnailObjectKey).download();
      } else {
        const [originalBytes] = await projectBucket.file(data.objectKey).download();
        thumbnailBytes = await createThumbnail(originalBytes);
      }
      return new Response(new Uint8Array(thumbnailBytes), { headers: { "Content-Type": "image/webp", "Content-Disposition": "inline", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
    }
    const bytes = await readBytes();
    if (preview && kind === "image") {
      return new Response(new Uint8Array(bytes), { headers: { "Content-Type": data.contentType, "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(data.fileName)}`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
    }
    if (preview && kind === "pdf") {
      return new Response(new Uint8Array(bytes), { headers: { "Content-Type": PDF_TYPE, "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(data.fileName)}`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
    }
    if (preview && kind === "docx") {
      if (bytes.length > 15 * 1024 * 1024)
        return NextResponse.json({ error: "This Word document is too large to preview" }, { status: 413 });
      try {
        const html = await renderDocx(bytes, String(data.fileName || "Document"));
        return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store", "Content-Security-Policy": "default-src 'none'; img-src data:; style-src 'unsafe-inline'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'", "X-Content-Type-Options": "nosniff", "X-Frame-Options": "SAMEORIGIN" } });
      } catch {
        return NextResponse.json({ error: "This Word document could not be previewed" }, { status: 422 });
      }
    }
    if (preview && kind === "audio") {
      return new Response(new Uint8Array(bytes), { headers: { "Content-Type": data.contentType, "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(data.fileName)}`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
    }
    return new Response(new Uint8Array(bytes), { headers: {
      "Content-Type": data.contentType || "application/octet-stream",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(data.fileName)}`,
      "Cache-Control": "private, no-store",
    } });
  }
  if (actor.role !== "admin" && !actor.permissions.documents)
    return NextResponse.json({ error: "Documents access required" }, { status: 403 });
  const snapshot = await firestore.collection(DOCUMENTS).where("projectId", "==", actor.projectId).get();
  const authors = await loadProjectAuthorDisplay(actor.projectId);
  const pending = new Set<string>();
  await Promise.all(snapshot.docs.map(async (doc) => {
    const data = doc.data();
    if (data.deletedAt || data.encryptionCleanupPending !== true) return;
    const root = vaultRootFolder(folders, typeof data.folderId === "string" ? data.folderId : null);
    if (root && vaults.get(root.id)?.granted && vaults.get(root.id)?.key &&
      !(await finishVaultMigration(doc.ref, data, actor.projectId))) pending.add(doc.id);
  }));
  const documents = snapshot.docs.filter((doc) => {
    if (doc.data().deletedAt) return false;
    if (pending.has(doc.id)) return false;
    const folderId = typeof doc.data().folderId === "string" ? doc.data().folderId : null;
    const topLevelId = folderTopLevelId(folderId, topLevelMap);
    if ((invoiceFolder && topLevelId === invoiceFolder.id) || (purchaseFolder && topLevelId === purchaseFolder.id)) return false;
    const root = vaultRootFolder(folders, folderId);
    if (root && (!vaults.get(root.id)?.granted || !vaults.get(root.id)?.key || doc.data().encrypted !== true || doc.data().vaultFolderId !== root.id)) return false;
    if (!root && doc.data().encrypted === true) return false;
    return canAccessFolder(actor, folderId, folderTopLevelId(folderId, topLevelMap));
  }).map((doc) => {
    const root = vaultRootFolder(folders, typeof doc.data().folderId === "string" ? doc.data().folderId : null);
    const data = root ? openVaultDocument(doc.data(), vaults.get(root.id)!.key!, actor.projectId, doc.id) : doc.data();
    const kind = previewKind(data.fileName, data.contentType);
    return {
      id: doc.id,
      name: data.fileName,
      contentType: data.contentType,
      size: data.size,
      uploadedBy: authors.display(data.uploadedBy, data.createdAt),
      folderId: typeof data.folderId === "string" ? data.folderId : null,
      createdAt: iso(data.createdAt),
      downloadUrl: `/api/files?id=${encodeURIComponent(doc.id)}`,
      isImage: isPreviewableImage(data.contentType),
      thumbnailUrl: isPreviewableImage(data.contentType) ? `/api/files?id=${encodeURIComponent(doc.id)}&preview=thumb` : null,
      previewKind: kind,
      previewUrl: kind ? `/api/files?id=${encodeURIComponent(doc.id)}&preview=${kind}` : null,
      aiIndexStatus: typeof data.aiIndexStatus === "string" ? data.aiIndexStatus : null,
      description: String(data.description || data.aiDescription || "").slice(0, 400),
      quoteReferenceSupported: isQuoteDocument(data.fileName, data.contentType),
      quoteReferenceEnabled: data.quoteReferenceEnabled === true,
      encrypted: data.encrypted === true,
    };
  }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return NextResponse.json({ documents, encryptionCleanupPending: pending.size }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request) {
  const actor = await requireTabAccess("documents", ["admin", "editor"]);
  if (!actor) return NextResponse.json({ error: "Documents editor access required" }, { status: 403 });
  if (!projectBucket) return NextResponse.json({ error: "Storage is unavailable" }, { status: 503 });
  const folders = await listProjectFolders(actor.projectId);
  const topLevelMap = buildTopLevelFolderMap(folders);
  const invoiceFolder = findExpenseInvoiceFolder(folders);
  const purchaseFolder = findExpensePurchaseFolder(folders);
  const form = await request.formData();
  const file = form.get("file");
  const folderId = typeof form.get("folderId") === "string" ? String(form.get("folderId")) : "";
  if (!(file instanceof File)) return NextResponse.json({ error: "A file is required" }, { status: 400 });
  if (file.size > 25 * 1024 * 1024) return NextResponse.json({ error: "Files are limited to 25 MB" }, { status: 413 });
  if (!canAccessFolder(actor, folderId || null, folderTopLevelId(folderId || null, topLevelMap)))
    return NextResponse.json({ error: "Folder access required" }, { status: 403 });
  const targetTopLevelId = folderTopLevelId(folderId || null, topLevelMap);
  if ((invoiceFolder && targetTopLevelId === invoiceFolder.id) || (purchaseFolder && targetTopLevelId === purchaseFolder.id))
    return NextResponse.json({ error: "Expense media must be uploaded from Expenses" }, { status: 409 });
  if (folderId) {
    const folder = await firestore.collection(FOLDERS).doc(folderId).get();
    if (!folder.exists || folder.data()?.projectId !== actor.projectId) return NextResponse.json({ error: "Folder not found" }, { status: 404 });
  }
  const root = vaultRootFolder(folders, folderId || null);
  const vaults = root ? await vaultAccess(actor, folders) : null;
  if (root && !vaults?.get(root.id)?.granted) return NextResponse.json({ error: "Folder access required" }, { status: 403 });
  const key = root ? vaults?.get(root.id)?.key : null;
  if (root && !key) return NextResponse.json({ error: "Unlock the encrypted folder first" }, { status: 423 });
  const ref = firestore.collection(DOCUMENTS).doc();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-");
  const objectKey = `${projectStoragePrefix(actor.projectId)}/documents/${ref.id}-${key ? `${randomUUID()}.enc` : safeName}`;
  const contentType = file.type || "application/octet-stream";
  const bytes = Buffer.from(await file.arrayBuffer());
  await projectBucket.file(objectKey).save(key ? encryptVaultBytes(bytes, key, vaultDocumentContext(actor.projectId, ref.id, "content")) : bytes, {
    contentType: key ? "application/octet-stream" : contentType,
    ...(key ? {} : { metadata: { metadata: { uploadedBy: actor.email, originalName: file.name } } }),
    resumable: false,
  });
  let thumbnailObjectKey: string | null = null;
  if (!key && isPreviewableImage(contentType)) {
    try {
      const thumbnail = await createThumbnail(bytes);
      thumbnailObjectKey = `${projectStoragePrefix(actor.projectId)}/thumbnails/${ref.id}.webp`;
      await projectBucket.file(thumbnailObjectKey).save(thumbnail, { contentType: "image/webp", resumable: false });
    } catch { thumbnailObjectKey = null; }
  }
  try {
    await commitActivity(actor, {
      category: "document", action: "document.uploaded",
      target: { type: "document", id: ref.id, label: key ? "Encrypted document" : file.name, section: "documents" },
      summaryParams: key ? {} : { size: file.size, contentType },
      changes: [{ field: "folder", before: null, after: folderId || null }],
      visibility: { folderTopLevelId: folderTopLevelId(folderId || null, topLevelMap), allowUnfiledRequired: !folderId, adminOnly: Boolean(key) },
    }, (transaction) => {
      if (root && key) transaction.update(firestore.collection(FOLDERS).doc(root.id), { vaultContentUpdatedAt: FieldValue.serverTimestamp() },
        { lastUpdateTime: vaults!.get(root.id)!.revision! });
      transaction.set(ref, { projectId: actor.projectId, objectKey, fileName: file.name, contentType, size: file.size, folderId: folderId || null, uploadedBy: actor.email, createdAt: FieldValue.serverTimestamp(), thumbnailObjectKey, quoteReferenceEnabled: false,
        ...(key && root ? sealVaultDocument({ fileName: file.name, contentType, size: file.size, uploadedBy: actor.email }, key, actor.projectId, ref.id, root.id) : {}),
      }, { merge: true });
      transaction.set(firestore.collection(CONFIG).doc(projectConfigDoc(actor.projectId)), { projectId: actor.projectId, documentsVersion: FieldValue.increment(1), documentsUpdatedAt: FieldValue.serverTimestamp(), documentsUpdatedBy: actor.email, documentsUpdatedFolderIds: [folderId || null] }, { merge: true });
    });
  } catch (error) {
    await projectBucket.file(objectKey).delete({ ignoreNotFound: true }).catch(() => undefined);
    if (thumbnailObjectKey) await projectBucket.file(thumbnailObjectKey).delete({ ignoreNotFound: true }).catch(() => undefined);
    throw error;
  }
  const index = key ? { status: "encrypted" } : await indexDocumentBytes({ projectId: actor.projectId, documentId: ref.id, bytes, fileName: file.name, contentType, folderId: folderId || null });
  return NextResponse.json({ id: ref.id, aiIndexStatus: index.status }, { status: 201 });
}

export async function PATCH(request: Request) {
  const actor = await requireTabAccess("documents", ["admin", "editor"]);
  if (!actor) return NextResponse.json({ error: "Documents editor access required" }, { status: 403 });
  const body = await request.json() as { id?: string; folderId?: string | null; description?: string; quoteReferenceEnabled?: boolean };
  if (!body.id) return NextResponse.json({ error: "Document is required" }, { status: 400 });
  const ref = firestore.collection(DOCUMENTS).doc(body.id);
  const snap = await ref.get();
  if (!snap.exists || snap.data()?.projectId !== actor.projectId || snap.data()?.deletedAt) return NextResponse.json({ error: "Document not found" }, { status: 404 });
  const folders = await listProjectFolders(actor.projectId);
  const topLevelMap = buildTopLevelFolderMap(folders);
  const invoiceFolder = findExpenseInvoiceFolder(folders);
  const purchaseFolder = findExpensePurchaseFolder(folders);
  const currentFolderId = typeof snap.data()?.folderId === "string" ? snap.data()!.folderId : null;
  const currentTopLevelId = folderTopLevelId(currentFolderId, topLevelMap);
  if ((invoiceFolder && currentTopLevelId === invoiceFolder.id) || (purchaseFolder && currentTopLevelId === purchaseFolder.id))
    return NextResponse.json({ error: "Expense media is managed from Expenses" }, { status: 404 });
  if (!canAccessFolder(actor, currentFolderId, folderTopLevelId(currentFolderId, topLevelMap))) return NextResponse.json({ error: "Document not found" }, { status: 404 });
  const movesFolder = Object.prototype.hasOwnProperty.call(body, "folderId");
  const updatesDescription = Object.prototype.hasOwnProperty.call(body, "description");
  const updatesQuoteReference = Object.prototype.hasOwnProperty.call(body, "quoteReferenceEnabled");
  if (!movesFolder && !updatesDescription && !updatesQuoteReference) return NextResponse.json({ error: "No document changes were provided" }, { status: 400 });
  if (updatesQuoteReference && typeof body.quoteReferenceEnabled !== "boolean") return NextResponse.json({ error: "Invalid quote reference setting" }, { status: 400 });
  if (body.quoteReferenceEnabled === true && !isQuoteDocument(snap.data()?.fileName, snap.data()?.contentType))
    return NextResponse.json({ error: "Only PDF, DOCX, JPG, PNG or WEBP files can be used in quote reviews" }, { status: 415 });
  const folderId = movesFolder && typeof body.folderId === "string" ? body.folderId : "";
  if (movesFolder) {
    const destinationTopLevelId = folderTopLevelId(folderId || null, topLevelMap);
    if ((invoiceFolder && destinationTopLevelId === invoiceFolder.id) || (purchaseFolder && destinationTopLevelId === purchaseFolder.id))
      return NextResponse.json({ error: "Expense media must be managed from Expenses" }, { status: 409 });
    if (!canAccessFolder(actor, folderId || null, folderTopLevelId(folderId || null, topLevelMap)))
      return NextResponse.json({ error: "Folder access required" }, { status: 403 });
    if (folderId) {
      const folder = await firestore.collection(FOLDERS).doc(folderId).get();
      if (!folder.exists || folder.data()?.projectId !== actor.projectId) return NextResponse.json({ error: "Folder not found" }, { status: 404 });
    }
  }
  const currentRoot = vaultRootFolder(folders, currentFolderId);
  const destinationRoot = vaultRootFolder(folders, movesFolder ? folderId || null : currentFolderId);
  if (currentRoot || destinationRoot || snap.data()?.encrypted === true) {
    const vaults = await vaultAccess(actor, folders);
    if (currentRoot && !vaults.get(currentRoot.id)?.granted)
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    const currentKey = currentRoot ? vaults.get(currentRoot.id)?.key : null;
    if (currentRoot && !currentKey) return NextResponse.json({ error: "Unlock the encrypted folder first" }, { status: 423 });
    if ((currentRoot && (snap.data()?.encrypted !== true || snap.data()?.vaultFolderId !== currentRoot.id)) || (!currentRoot && snap.data()?.encrypted === true))
      return NextResponse.json({ error: "Document encryption is inconsistent" }, { status: 409 });
    if (currentRoot && currentRoot.id !== destinationRoot?.id)
      return NextResponse.json({ error: "Encrypted documents must remain inside their protected folder" }, { status: 409 });
    if (!destinationRoot || !vaults.get(destinationRoot.id)?.granted)
      return NextResponse.json({ error: "Folder access required" }, { status: 403 });
    const key = vaults.get(destinationRoot.id)?.key;
    if (!key) return NextResponse.json({ error: "Unlock the encrypted folder first" }, { status: 423 });
    if (body.quoteReferenceEnabled === true)
      return NextResponse.json({ error: "Encrypted documents cannot be used as quote references" }, { status: 409 });
    if (!projectBucket) return NextResponse.json({ error: "Storage is unavailable" }, { status: 503 });
    const previous = snap.data()!;
    if (currentRoot && !(await finishVaultMigration(snap.ref, previous, actor.projectId)))
      return NextResponse.json({ error: "Encryption cleanup is pending. Refresh the folder to retry" }, { status: 503 });
    // Cleanup may update the record; use its current revision for the next mutation.
    const mutationSnapshot = previous.encryptionCleanupPending === true ? await ref.get() : snap;
    const currentData = mutationSnapshot.data();
    if (!currentData || currentData.projectId !== actor.projectId || currentData.deletedAt || currentData.folderId !== previous.folderId ||
      (currentRoot && (currentData.encrypted !== true || currentData.vaultFolderId !== currentRoot.id)))
      return NextResponse.json({ error: "Document changed. Refresh the folder and try again" }, { status: 409 });
    const metadata = currentKey ? openVaultDocument(currentData, currentKey, actor.projectId, snap.id) : currentData;
    if (updatesDescription) metadata.description = typeof body.description === "string" ? body.description.trim().slice(0, 400) : "";
    let objectKey = String(currentData.objectKey);
    const migrating = !currentRoot;
    if (migrating && (currentData.source === "mobile_capture" ||
      (typeof currentData.captureId === "string" && currentData.captureId)))
      return NextResponse.json({ error: "Linked mobile captures cannot be moved into encrypted folders because their attachments remain shared in Decisions or Site progress. Upload a separate copy directly into the protected folder" }, { status: 409 });
    if (migrating) {
      const [bytes] = await projectBucket.file(objectKey).download();
      objectKey = `${projectStoragePrefix(actor.projectId)}/documents/${snap.id}-${randomUUID()}.enc`;
      await projectBucket.file(objectKey).save(encryptVaultBytes(bytes, key, vaultDocumentContext(actor.projectId, snap.id, "content")),
        { contentType: "application/octet-stream", resumable: false });
    }
    try {
      await commitActivity(actor, {
        category: "document", action: movesFolder ? "document.moved" : "document.description_updated",
        target: { type: "document", id: snap.id, label: "Encrypted document", section: "documents" },
        changes: [], visibility: { adminOnly: true },
      }, (transaction) => {
        transaction.update(firestore.collection(FOLDERS).doc(destinationRoot.id), { vaultContentUpdatedAt: FieldValue.serverTimestamp() },
          { lastUpdateTime: vaults.get(destinationRoot.id)!.revision! });
        transaction.update(ref, { objectKey,
          ...(movesFolder ? { folderId: folderId || null } : {}),
          ...sealVaultDocument(metadata, key, actor.projectId, snap.id, destinationRoot.id),
          ...(migrating ? { encryptionCleanupPending: true, encryptionCleanupKeys: [String(previous.objectKey), ...(previous.thumbnailObjectKey ? [String(previous.thumbnailObjectKey)] : [])] } : {}),
          updatedAt: FieldValue.serverTimestamp(),
        }, { lastUpdateTime: mutationSnapshot.updateTime! });
        transaction.set(firestore.collection(CONFIG).doc(projectConfigDoc(actor.projectId)), { projectId: actor.projectId,
          documentsVersion: FieldValue.increment(1), documentsUpdatedAt: FieldValue.serverTimestamp(), documentsUpdatedBy: actor.email,
          documentsUpdatedFolderIds: movesFolder ? [...new Set([currentFolderId, folderId || null])] : [currentFolderId],
        }, { merge: true });
      });
    } catch (error) {
      if (migrating) await projectBucket.file(objectKey).delete({ ignoreNotFound: true }).catch(() => undefined);
      throw error;
    }
    if (migrating) {
      if (!(await finishVaultMigration(ref, { encryptionCleanupPending: true,
        encryptionCleanupKeys: [String(previous.objectKey), ...(previous.thumbnailObjectKey ? [String(previous.thumbnailObjectKey)] : [])] }, actor.projectId)))
        return NextResponse.json({ error: "Encryption cleanup is pending. Refresh the folder to retry" }, { status: 503 });
    }
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "private, no-store" } });
  }
  const description = updatesDescription && typeof body.description === "string" ? body.description.trim().slice(0, 400) : "";
  const update = {
    ...(movesFolder ? { folderId: folderId || null, movedBy: actor.email } : {}),
    ...(updatesDescription ? { description, descriptionUpdatedBy: actor.email, descriptionUpdatedAt: FieldValue.serverTimestamp() } : {}),
    ...(updatesQuoteReference ? { quoteReferenceEnabled: body.quoteReferenceEnabled, quoteReferenceUpdatedBy: actor.email, quoteReferenceUpdatedAt: FieldValue.serverTimestamp() } : {}),
    updatedAt: FieldValue.serverTimestamp(),
  };
  const oldTop = folderTopLevelId(currentFolderId, topLevelMap);
  const newTop = folderTopLevelId(movesFolder ? folderId || null : currentFolderId, topLevelMap);
  const folderName = (id: string | null) => folders.find((folder) => folder.id === id)?.name || (id ? "Folder" : "Unfiled");
  const changes = [
    ...(movesFolder && currentFolderId !== (folderId || null) ? [{ field: "folder", before: folderName(currentFolderId), after: folderName(folderId || null), format: "text" as const }] : []),
    ...(updatesDescription && String(snap.data()?.description || "") !== description ? [{ field: "description", before: snap.data()?.description ? "Present" : "Empty", after: description ? "Present" : "Empty", format: "status" as const }] : []),
    ...(updatesQuoteReference && (snap.data()?.quoteReferenceEnabled === true) !== body.quoteReferenceEnabled ? [{ field: "quoteReference", before: snap.data()?.quoteReferenceEnabled === true, after: body.quoteReferenceEnabled, format: "status" as const }] : []),
  ];
  if (!changes.length) return NextResponse.json({ ok: true, unchanged: true });
  await commitActivity(actor, {
    category: "document", action: movesFolder ? "document.moved" : updatesQuoteReference ? "document.quote_reference_updated" : "document.description_updated",
    target: { type: "document", id: body.id, label: String(snap.data()?.fileName || "Document"), section: "documents" }, changes,
    visibility: { folderTopLevelIds: [oldTop, newTop].filter((id): id is string => Boolean(id)), allowUnfiledRequired: !currentFolderId || (movesFolder && !folderId) },
  }, (transaction) => {
    transaction.update(ref, update, { lastUpdateTime: snap.updateTime! });
    transaction.set(firestore.collection(CONFIG).doc(projectConfigDoc(actor.projectId)), { projectId: actor.projectId, documentsVersion: FieldValue.increment(1), documentsUpdatedAt: FieldValue.serverTimestamp(), documentsUpdatedBy: actor.email, documentsUpdatedFolderIds: movesFolder ? [...new Set([currentFolderId, folderId || null])] : [currentFolderId] }, { merge: true });
  });
  if (movesFolder) await updateDocumentIndexFolder(actor.projectId, body.id, folderId || null);
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const actor = await requireTabAccess("documents", ["admin"]);
  if (!actor) return NextResponse.json({ error: "Owner access required" }, { status: 403 });
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Document is required" }, { status: 400 });
  const ref = firestore.collection(DOCUMENTS).doc(id);
  const snap = await ref.get();
  if (!snap.exists || snap.data()?.projectId !== actor.projectId || snap.data()?.deletedAt)
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  const data = snap.data()!;
  const folderId = typeof data.folderId === "string" ? data.folderId : null;
  const folders = await listProjectFolders(actor.projectId);
  const topLevelMap = buildTopLevelFolderMap(folders);
  const invoiceFolder = findExpenseInvoiceFolder(folders);
  const purchaseFolder = findExpensePurchaseFolder(folders);
  const topLevelId = folderTopLevelId(folderId, topLevelMap);
  if ((invoiceFolder && topLevelId === invoiceFolder.id) || (purchaseFolder && topLevelId === purchaseFolder.id))
    return NextResponse.json({ error: "Expense media is managed from Expenses" }, { status: 404 });
  const root = vaultRootFolder(folders, folderId);
  const access = root ? (await vaultAccess(actor, folders)).get(root.id) : null;
  if (root && !access?.key)
    return NextResponse.json({ error: "Unlock the encrypted folder first" }, { status: 423 });
  await commitActivity(actor, {
    category: "document", action: "document.deleted",
    target: { type: "document", id, label: root ? "Encrypted document" : String(data.fileName || "Document"), section: "documents", exists: false },
    summaryParams: root ? {} : { size: Number(data.size || 0), contentType: String(data.contentType || "") },
    changes: [{ field: "deleted", before: false, after: true, format: "status" }],
    visibility: { folderTopLevelId: folderTopLevelId(folderId, topLevelMap), allowUnfiledRequired: !folderId, adminOnly: Boolean(root) },
  }, (transaction) => {
    if (root) transaction.update(firestore.collection(FOLDERS).doc(root.id), { vaultContentUpdatedAt: FieldValue.serverTimestamp() },
      { lastUpdateTime: access!.revision! });
    transaction.update(ref, { deletedAt: FieldValue.serverTimestamp(), deletedBy: actor.email, updatedAt: FieldValue.serverTimestamp() },
      { lastUpdateTime: snap.updateTime! });
    transaction.set(firestore.collection(CONFIG).doc(projectConfigDoc(actor.projectId)), { projectId: actor.projectId, documentsVersion: FieldValue.increment(1), documentsUpdatedAt: FieldValue.serverTimestamp(), documentsUpdatedBy: actor.email, documentsUpdatedFolderIds: [folderId] }, { merge: true });
  });
  await removeDocumentIndex(actor.projectId, id);
  return NextResponse.json({ ok: true, recoverable: true });
}
