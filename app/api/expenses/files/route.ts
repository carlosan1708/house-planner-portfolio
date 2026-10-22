import { expensePaymentDocumentIds } from "@/lib/expense-records";
import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import sharp from "sharp";
import { commitActivity } from "@/lib/activity";
import { requireTabAccess } from "@/lib/auth";
import { firestore, projectBucket } from "@/lib/firebase-admin";
import { ensureExpenseInvoiceFolder, findExpenseInvoiceFolder, listProjectFolders } from "@/lib/folders";
import { DOCUMENTS, EXPENSES, EXPENSE_DOCUMENTS, EXPENSE_PAYMENTS, projectStoragePrefix } from "@/lib/project";

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]);
const ALLOWED_TYPES = new Set([...IMAGE_TYPES, "application/pdf"]);

function iso(value: unknown) {
  return value && typeof value === "object" && "toDate" in value
    ? (value as FirebaseFirestore.Timestamp).toDate().toISOString()
    : new Date(0).toISOString();
}

function invoiceJson(document: FirebaseFirestore.QueryDocumentSnapshot | FirebaseFirestore.DocumentSnapshot, linkedCount = 0) {
  const data = document.data() || {};
  const isImage = IMAGE_TYPES.has(String(data.contentType || "").toLowerCase());
  return {
    id: document.id,
    name: String(data.fileName || "Invoice"),
    contentType: String(data.contentType || "application/octet-stream"),
    size: Number(data.size || 0),
    folderId: typeof data.folderId === "string" ? data.folderId : null,
    createdAt: iso(data.createdAt),
    isImage,
    thumbnailUrl: isImage ? `/api/files?id=${encodeURIComponent(document.id)}&preview=thumb` : null,
    previewKind: isImage ? "image" : String(data.contentType) === "application/pdf" ? "pdf" : null,
    previewUrl: `/api/files?id=${encodeURIComponent(document.id)}&preview=${isImage ? "image" : "pdf"}`,
    description: String(data.description || "").slice(0, 500),
    linkedCount,
  };
}

export async function GET() {
  const actor = await requireTabAccess("expenses");
  if (!actor) return NextResponse.json({ error: "Expenses access required" }, { status: 403 });
  let folders = await listProjectFolders(actor.projectId);
  let invoiceFolder = findExpenseInvoiceFolder(folders);
  if (!invoiceFolder && actor.role === "admin") {
    invoiceFolder = await ensureExpenseInvoiceFolder(actor.projectId, actor.email);
    folders = [...folders, invoiceFolder];
  }
  if (!invoiceFolder) return NextResponse.json({ documents: [] }, { headers: { "Cache-Control": "private, no-store" } });
  const [documents, links] = await Promise.all([
    firestore.collection(DOCUMENTS).where("projectId", "==", actor.projectId).get(),
    firestore.collection(EXPENSES).where("projectId", "==", actor.projectId).get(),
  ]);
  const counts = new Map<string, number>();
  for (const link of links.docs) {
    if (link.data().deletedAt || link.data().status === "void") continue;
    const documentId = String(link.data().receiptDocumentId || link.data().documentId || "");
    if (documentId) counts.set(documentId, (counts.get(documentId) || 0) + 1);
  }
  const result = documents.docs
    .filter((item) => !item.data().deletedAt && item.data().folderId === invoiceFolder?.id && ALLOWED_TYPES.has(String(item.data().contentType || "").toLowerCase()))
    .map((item) => invoiceJson(item, counts.get(item.id) || 0))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return NextResponse.json({ documents: result }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request) {
  const actor = await requireTabAccess("expenses", ["admin", "editor"]);
  if (!actor) return NextResponse.json({ error: "Expenses editor access required" }, { status: 403 });
  if (!projectBucket) return NextResponse.json({ error: "Storage is unavailable" }, { status: 503 });
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "An invoice is required" }, { status: 400 });
  const contentType = file.type.toLowerCase();
  if (!ALLOWED_TYPES.has(contentType)) return NextResponse.json({ error: "Invoices must be an image or PDF" }, { status: 415 });
  if (file.size <= 0 || file.size > 25 * 1024 * 1024) return NextResponse.json({ error: "Invoices are limited to 25 MB" }, { status: 413 });
  const invoiceFolder = await ensureExpenseInvoiceFolder(actor.projectId, actor.email);
  const ref = firestore.collection(DOCUMENTS).doc();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-");
  const objectKey = `${projectStoragePrefix(actor.projectId)}/invoices/${ref.id}-${safeName}`;
  const bytes = Buffer.from(await file.arrayBuffer());
  await projectBucket.file(objectKey).save(bytes, { contentType, resumable: false, metadata: { metadata: { uploadedBy: actor.email, originalName: file.name } } });
  let thumbnailObjectKey: string | null = null;
  if (IMAGE_TYPES.has(contentType)) {
    try {
      const thumbnail = await sharp(bytes, { limitInputPixels: 50_000_000 }).rotate().resize(560, 420, { fit: "inside", withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
      thumbnailObjectKey = `${projectStoragePrefix(actor.projectId)}/invoice-thumbnails/${ref.id}.webp`;
      await projectBucket.file(thumbnailObjectKey).save(thumbnail, { contentType: "image/webp", resumable: false });
    } catch { thumbnailObjectKey = null; }
  }
  try {
    await commitActivity(actor, {
      category: "expense", action: "expense.invoice_uploaded",
      target: { type: "invoice", id: ref.id, label: file.name, section: "expenses" },
      summaryParams: { size: file.size, contentType },
      changes: [{ field: "invoice", before: null, after: file.name, format: "text" }],
      visibility: { requiredTabs: ["expenses"] },
    }, (transaction) => transaction.set(ref, {
      projectId: actor.projectId, objectKey, fileName: file.name, contentType, size: file.size,
      folderId: invoiceFolder.id, uploadedBy: actor.email, source: "expenses", thumbnailObjectKey,
      createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
    }));
  } catch (error) {
    await projectBucket.file(objectKey).delete({ ignoreNotFound: true }).catch(() => undefined);
    if (thumbnailObjectKey) await projectBucket.file(thumbnailObjectKey).delete({ ignoreNotFound: true }).catch(() => undefined);
    throw error;
  }
  return NextResponse.json({ document: invoiceJson(await ref.get()) }, { status: 201 });
}

export async function DELETE(request: Request) {
  const actor = await requireTabAccess("expenses", ["admin", "editor"]);
  if (!actor) return NextResponse.json({ error: "Expenses editor access required" }, { status: 403 });
  const id = new URL(request.url).searchParams.get("id") || "";
  const ref = firestore.collection(DOCUMENTS).doc(id);
  const [document, folders, links, records, payments] = await Promise.all([
    ref.get(), listProjectFolders(actor.projectId),
    firestore.collection(EXPENSES).where("projectId", "==", actor.projectId).get(),
    firestore.collection(EXPENSE_DOCUMENTS).where("projectId", "==", actor.projectId).get(),
    firestore.collection(EXPENSE_PAYMENTS).where("projectId", "==", actor.projectId).get(),
  ]);
  const invoiceFolder = findExpenseInvoiceFolder(folders);
  if (!id || !document.exists || document.data()?.projectId !== actor.projectId || document.data()?.deletedAt || document.data()?.folderId !== invoiceFolder?.id)
    return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  if (links.docs.some((link) => !link.data().deletedAt && link.data().status !== "void" && (link.data().receiptDocumentId === id || link.data().documentId === id)))
    return NextResponse.json({ error: "Unlink this invoice from its expenses before deleting it" }, { status: 409 });
  if (records.docs.some((record) => !record.data().deletedAt && Array.isArray(record.data().fileIds) && record.data().fileIds.includes(id)))
    return NextResponse.json({ error: "Delete this file from its comprobante first" }, { status: 409 });
  if (payments.docs.some((payment) => !payment.data().deletedAt && expensePaymentDocumentIds(payment.data()).includes(`legacy:${id}`)))
    return NextResponse.json({ error: "Unlink this receipt from its payments before deleting it" }, { status: 409 });
  class ReceiptConflict extends Error {}
  try { await commitActivity(actor, {
    category: "expense", action: "expense.invoice_deleted",
    target: { type: "invoice", id, label: String(document.data()?.fileName || "Invoice"), section: "expenses", exists: false },
    changes: [{ field: "deleted", before: false, after: true, format: "status" }],
    visibility: { requiredTabs: ["expenses"] },
  }, (transaction) => transaction.set(ref, { deletedAt: FieldValue.serverTimestamp(), deletedBy: actor.email, updatedAt: FieldValue.serverTimestamp() }, { merge: true }), async (transaction) => {
    const latest = await transaction.get(ref);
    const payments = await transaction.get(firestore.collection(EXPENSE_PAYMENTS).where("projectId", "==", actor.projectId));
    if (!latest.exists || latest.data()?.deletedAt || payments.docs.some((payment) => !payment.data().deletedAt && expensePaymentDocumentIds(payment.data()).includes(`legacy:${id}`))) throw new ReceiptConflict("Unlink this receipt from its payments before deleting it");
  }); } catch (error) { if (error instanceof ReceiptConflict) return NextResponse.json({ error: error.message }, { status: 409 }); throw error; }
  return NextResponse.json({ ok: true, recoverable: true });
}
