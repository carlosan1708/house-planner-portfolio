import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import sharp from "sharp";
import { requireTabAccess } from "@/lib/auth";
import { commitActivity } from "@/lib/activity";
import { firestore, projectBucket } from "@/lib/firebase-admin";
import { ensureExpensePurchaseFolder } from "@/lib/folders";
import { mediaJson } from "@/lib/expense-api";
import { DOCUMENTS, PURCHASES, projectStoragePrefix } from "@/lib/project";

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);

export async function POST(request: Request) {
  const actor = await requireTabAccess("expenses", ["admin", "editor"]);
  if (!actor) return NextResponse.json({ error: "Expenses editor access required" }, { status: 403 });
  if (!projectBucket) return NextResponse.json({ error: "Storage is unavailable" }, { status: 503 });
  const form = await request.formData();
  const purchaseId = String(form.get("purchaseId") || "");
  const purchase = await firestore.collection(PURCHASES).doc(purchaseId).get();
  if (!purchase.exists || purchase.data()?.projectId !== actor.projectId || purchase.data()?.deletedAt) return NextResponse.json({ error: "Compra no encontrada" }, { status: 404 });
  const files = [...form.getAll("files"), ...form.getAll("file")].filter((item): item is File => item instanceof File);
  if (!files.length) return NextResponse.json({ error: "Seleccioná al menos una foto" }, { status: 400 });
  if (files.length > 20) return NextResponse.json({ error: "Podés subir hasta 20 fotos a la vez" }, { status: 400 });
  for (const file of files) {
    if (!IMAGE_TYPES.has(file.type.toLowerCase())) return NextResponse.json({ error: "Las fotos deben ser JPEG, PNG, WebP o AVIF" }, { status: 415 });
    if (file.size <= 0 || file.size > 15 * 1024 * 1024) return NextResponse.json({ error: "Cada foto puede pesar hasta 15 MB" }, { status: 413 });
  }
  const folder = await ensureExpensePurchaseFolder(actor.projectId, actor.email);
  const uploaded = [];
  for (const file of files) {
    const ref = firestore.collection(DOCUMENTS).doc();
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-");
    const objectKey = `${projectStoragePrefix(actor.projectId)}/purchase-photos/${ref.id}-${safeName}`;
    const thumbnailObjectKey = `${projectStoragePrefix(actor.projectId)}/purchase-thumbnails/${ref.id}.webp`;
    const bytes = Buffer.from(await file.arrayBuffer());
    await projectBucket.file(objectKey).save(bytes, { contentType: file.type, resumable: false, metadata: { metadata: { uploadedBy: actor.email, originalName: file.name } } });
    try {
      const thumb = await sharp(bytes, { limitInputPixels: 50_000_000 }).rotate().resize(720, 540, { fit: "inside", withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
      await projectBucket.file(thumbnailObjectKey).save(thumb, { contentType: "image/webp", resumable: false });
      await commitActivity(actor, { category: "expense", action: "expense.purchase_photo_added", target: { type: "purchase", id: purchaseId, label: String(purchase.data()?.title || "Compra"), section: "expenses" }, summaryParams: { fileName: file.name }, changes: [{ field: "photo", before: null, after: file.name }] }, (transaction) => {
        transaction.set(ref, { projectId: actor.projectId, purchaseId, mediaRole: "product_photo", source: "expense_purchase", objectKey, thumbnailObjectKey, fileName: file.name, contentType: file.type, size: file.size, folderId: folder.id, uploadedBy: actor.email, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(), deletedAt: null });
        if (!purchase.data()?.coverPhotoId) transaction.set(purchase.ref, { coverPhotoId: ref.id, updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.email }, { merge: true });
      });
      uploaded.push(mediaJson(await ref.get()));
    } catch (error) {
      await projectBucket.file(objectKey).delete({ ignoreNotFound: true }).catch(() => undefined);
      await projectBucket.file(thumbnailObjectKey).delete({ ignoreNotFound: true }).catch(() => undefined);
      throw error;
    }
  }
  return NextResponse.json({ photos: uploaded }, { status: 201 });
}

export async function DELETE(request: Request) {
  const actor = await requireTabAccess("expenses", ["admin", "editor"]);
  if (!actor) return NextResponse.json({ error: "Expenses editor access required" }, { status: 403 });
  const id = new URL(request.url).searchParams.get("id") || "";
  const ref = firestore.collection(DOCUMENTS).doc(id);
  const photo = await ref.get();
  if (!photo.exists || photo.data()?.projectId !== actor.projectId || photo.data()?.source !== "expense_purchase" || photo.data()?.deletedAt) return NextResponse.json({ error: "Foto no encontrada" }, { status: 404 });
  const purchase = await firestore.collection(PURCHASES).doc(String(photo.data()?.purchaseId || "")).get();
  await commitActivity(actor, { category: "expense", action: "expense.purchase_photo_deleted", target: { type: "purchase", id: purchase.id, label: String(purchase.data()?.title || "Compra"), section: "expenses" }, changes: [{ field: "photo", before: photo.data()?.fileName, after: null }] }, (transaction) => {
    transaction.set(ref, { deletedAt: FieldValue.serverTimestamp(), deletedBy: actor.email, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    if (purchase.exists && purchase.data()?.coverPhotoId === id) transaction.set(purchase.ref, { coverPhotoId: null, updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.email }, { merge: true });
  });
  return NextResponse.json({ ok: true, recoverable: true });
}
