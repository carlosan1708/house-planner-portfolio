import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import sharp from "sharp";
import { requireTabAccess } from "@/lib/auth";
import { commitActivity } from "@/lib/activity";
import { firestore, projectBucket } from "@/lib/firebase-admin";
import { ensureExpenseInvoiceFolder } from "@/lib/folders";
import { DOCUMENTS, EXPENSE_DOCUMENTS, projectStoragePrefix } from "@/lib/project";

const IMAGES = new Set(["image/jpeg", "image/png", "image/webp", "image/avif", "image/gif"]);
const ALLOWED = new Set([...IMAGES, "application/pdf"]);

export async function POST(request: Request) {
  const actor = await requireTabAccess("expenses", ["admin", "editor"]);
  if (!actor) return NextResponse.json({ error: "Expenses editor access required" }, { status: 403 });
  if (!projectBucket) return NextResponse.json({ error: "Storage is unavailable" }, { status: 503 });
  const bucket = projectBucket;
  const form = await request.formData();
  const id = String(form.get("documentId") || "");
  const record = await firestore.collection(EXPENSE_DOCUMENTS).doc(id).get();
  if (!record.exists || record.data()?.projectId !== actor.projectId || record.data()?.deletedAt) return NextResponse.json({ error: "Comprobante no encontrado" }, { status: 404 });
  const files = [...form.getAll("files"), ...form.getAll("file")].filter((value): value is File => value instanceof File);
  if (!files.length) return NextResponse.json({ error: "Agregá al menos una imagen o PDF" }, { status: 400 });
  if (files.length > 20) return NextResponse.json({ error: "Podés subir hasta 20 archivos a la vez" }, { status: 400 });
  for (const file of files) {
    if (!ALLOWED.has(file.type.toLowerCase())) return NextResponse.json({ error: "Los comprobantes deben ser imágenes o PDF" }, { status: 415 });
    if (file.size <= 0 || file.size > 25 * 1024 * 1024) return NextResponse.json({ error: "Cada archivo puede pesar hasta 25 MB" }, { status: 413 });
  }
  const folder = await ensureExpenseInvoiceFolder(actor.projectId, actor.email);
  const added: Array<{ ref: FirebaseFirestore.DocumentReference; objectKey: string; thumbnailObjectKey: string | null; file: File }> = [];
  try {
    for (const file of files) {
      const ref = firestore.collection(DOCUMENTS).doc();
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-");
      const objectKey = `${projectStoragePrefix(actor.projectId)}/invoices/${ref.id}-${safeName}`;
      const bytes = Buffer.from(await file.arrayBuffer());
      await bucket.file(objectKey).save(bytes, { contentType: file.type, resumable: false, metadata: { metadata: { uploadedBy: actor.email, originalName: file.name } } });
      let thumbnailObjectKey: string | null = null;
      if (IMAGES.has(file.type)) {
        thumbnailObjectKey = `${projectStoragePrefix(actor.projectId)}/invoice-thumbnails/${ref.id}.webp`;
        const thumb = await sharp(bytes, { limitInputPixels: 50_000_000 }).rotate().resize(720, 540, { fit: "inside", withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
        await bucket.file(thumbnailObjectKey).save(thumb, { contentType: "image/webp", resumable: false });
      }
      added.push({ ref, objectKey, thumbnailObjectKey, file });
    }
    const currentIds = Array.isArray(record.data()?.fileIds) ? record.data()!.fileIds.filter((value: unknown): value is string => typeof value === "string") : [];
    await commitActivity(actor, { category: "expense", action: "expense.document_files_added", target: { type: "expense_document", id, label: String(record.data()?.title || "Comprobante"), section: "expenses" }, summaryParams: { fileCount: added.length }, changes: [{ field: "files", before: currentIds.length, after: currentIds.length + added.length }] }, (transaction) => {
      for (const item of added) transaction.set(item.ref, { projectId: actor.projectId, expenseDocumentId: id, mediaRole: "financial_document", source: "expense_document", objectKey: item.objectKey, thumbnailObjectKey: item.thumbnailObjectKey, fileName: item.file.name, contentType: item.file.type, size: item.file.size, folderId: folder.id, uploadedBy: actor.email, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(), deletedAt: null });
      transaction.set(record.ref, { fileIds: [...currentIds, ...added.map((item) => item.ref.id)], updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.email }, { merge: true });
    });
  } catch (error) {
    await Promise.all(added.flatMap((item) => [bucket.file(item.objectKey).delete({ ignoreNotFound: true }).catch(() => undefined), item.thumbnailObjectKey ? bucket.file(item.thumbnailObjectKey).delete({ ignoreNotFound: true }).catch(() => undefined) : Promise.resolve()]));
    throw error;
  }
  return NextResponse.json({ ok: true, added: added.length }, { status: 201 });
}

export async function DELETE(request: Request) {
  const actor = await requireTabAccess("expenses", ["admin", "editor"]);
  if (!actor) return NextResponse.json({ error: "Expenses editor access required" }, { status: 403 });
  const url = new URL(request.url); const documentId = url.searchParams.get("documentId") || ""; const fileId = url.searchParams.get("fileId") || "";
  const [record, file] = await Promise.all([firestore.collection(EXPENSE_DOCUMENTS).doc(documentId).get(), firestore.collection(DOCUMENTS).doc(fileId).get()]);
  const ids = Array.isArray(record.data()?.fileIds) ? record.data()!.fileIds.filter((value: unknown): value is string => typeof value === "string") : [];
  if (!record.exists || record.data()?.projectId !== actor.projectId || record.data()?.deletedAt || !file.exists || file.data()?.projectId !== actor.projectId || file.data()?.deletedAt || !ids.includes(fileId)) return NextResponse.json({ error: "Archivo no encontrado" }, { status: 404 });
  if (ids.length <= 1) return NextResponse.json({ error: "Un comprobante debe conservar al menos un archivo" }, { status: 409 });
  await commitActivity(actor, { category: "expense", action: "expense.document_file_deleted", target: { type: "expense_document", id: documentId, label: String(record.data()?.title || "Comprobante"), section: "expenses" }, changes: [{ field: "file", before: file.data()?.fileName, after: null }] }, (transaction) => {
    transaction.set(file.ref, { deletedAt: FieldValue.serverTimestamp(), deletedBy: actor.email, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    transaction.set(record.ref, { fileIds: ids.filter((id: string) => id !== fileId), updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.email }, { merge: true });
  });
  return NextResponse.json({ ok: true, recoverable: true });
}
