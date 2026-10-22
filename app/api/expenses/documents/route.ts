import { lockProjectCurrency } from "@/lib/project-currency";
import type { ProjectCurrency } from "@/lib/currency";
import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import sharp from "sharp";
import { requireTabAccess } from "@/lib/auth";
import { commitActivity } from "@/lib/activity";
import { firestore, projectBucket } from "@/lib/firebase-admin";
import { ensureExpenseInvoiceFolder } from "@/lib/folders";
import { expenseIso, mediaJson, expenseBudgetLines, projectMedia, legacyExpenseDocuments } from "@/lib/expense-api";
import { cleanExpenseAmount, cleanExpenseBudgetLineIds, cleanExpenseCurrency, cleanExpenseDate, cleanExpenseDocumentType, cleanExpenseNotes, cleanExpenseText, expensePaymentDocumentIds } from "@/lib/expense-records";
import { DOCUMENTS, EXPENSE_DOCUMENTS, EXPENSE_PAYMENTS, PURCHASES, projectStoragePrefix } from "@/lib/project";

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/avif", "image/gif"]);
const ALLOWED_TYPES = new Set([...IMAGE_TYPES, "application/pdf"]);
const nullableId = (value: unknown) => typeof value === "string" && value.trim() ? value.trim().slice(0, 200) : null;

type Metadata = { title?: unknown; documentType?: unknown; documentDate?: unknown; vendor?: unknown; reference?: unknown; notes?: unknown; amount?: unknown; currency?: unknown; purchaseId?: unknown; budgetLineId?: unknown; budgetLineIds?: unknown };

async function normalize(projectId: string, body: Metadata, defaultCurrency: ProjectCurrency, defaultTitle = "") {
  const title = cleanExpenseText(body.title, 160) || cleanExpenseText(defaultTitle, 160) || "Comprobante sin descripción";
  const purchaseId = nullableId(body.purchaseId);
  const purchase = purchaseId ? await firestore.collection(PURCHASES).doc(purchaseId).get() : null;
  if (purchaseId && (!purchase?.exists || purchase.data()?.projectId !== projectId || purchase.data()?.deletedAt)) return { error: NextResponse.json({ error: "La compra seleccionada no existe en este proyecto" }, { status: 400 }) };
  const budgetLineIds = cleanExpenseBudgetLineIds(body.budgetLineIds, body.budgetLineId);
  if (purchase?.data()?.outsideObjective === true && budgetLineIds.length) return { error: NextResponse.json({ error: "Un comprobante de una compra fuera de objetivo no puede tener partidas" }, { status: 409 }) };
  const paidLines = budgetLineIds.length ? await expenseBudgetLines(projectId) : [];
  const paidById = new Map(paidLines.map((line) => [line.id, line]));
  const invalidLine = budgetLineIds.find((id) => !paidById.has(id));
  if (invalidLine) return { error: NextResponse.json({ error: "La partida seleccionada no existe en este proyecto" }, { status: 400 }) };

  const budgetLines = budgetLineIds.map((id) => ({ id, label: paidById.get(id)!.label }));
  const firstLine = budgetLines[0];
  return { record: {
    title, documentType: cleanExpenseDocumentType(body.documentType), documentDate: cleanExpenseDate(body.documentDate),
    vendor: cleanExpenseText(body.vendor, 160), reference: cleanExpenseText(body.reference, 160), notes: cleanExpenseNotes(body.notes),
    amount: cleanExpenseAmount(body.amount), currency: body.currency === undefined || body.currency === null || body.currency === "" ? defaultCurrency : cleanExpenseCurrency(body.currency), purchaseId,
    purchaseTitle: purchase ? String(purchase.data()?.title || "") : "", budgetLineIds, budgetLines,
    budgetLineId: firstLine?.id || null, budgetLineLabel: firstLine?.label || "",
  } };
}

async function payload(projectId: string) {
  const [records, media, purchases, payments] = await Promise.all([
    firestore.collection(EXPENSE_DOCUMENTS).where("projectId", "==", projectId).get(), projectMedia(projectId),
    firestore.collection(PURCHASES).where("projectId", "==", projectId).get(),
    firestore.collection(EXPENSE_PAYMENTS).where("projectId", "==", projectId).get(),
  ]);
  const byId = new Map(media.map((item) => [item.id, item]));
  const documents = records.docs.filter((item) => !item.data().deletedAt).map((item) => {
    const data = item.data();
    const paymentIds = payments.docs.filter((payment) => !payment.data().deletedAt && expensePaymentDocumentIds(payment.data()).includes(item.id)).map((payment) => payment.id);
    const relatedPurchase = purchases.docs.find((purchase) => purchase.id === data.purchaseId && !purchase.data().deletedAt);
    const fileIds = Array.isArray(data.fileIds) ? data.fileIds.filter((id): id is string => typeof id === "string") : [];
    const budgetLineIds = cleanExpenseBudgetLineIds(data.budgetLineIds, data.budgetLineId);
    const storedBudgetLines = Array.isArray(data.budgetLines)
      ? data.budgetLines.flatMap((line: unknown) => line && typeof line === "object" && "id" in line && typeof line.id === "string" ? [{ id: line.id, label: "label" in line ? String(line.label || "") : "" }] : [])
      : [];
    const budgetLines = budgetLineIds.map((id) => storedBudgetLines.find((line) => line.id === id) || { id, label: id === data.budgetLineId ? String(data.budgetLineLabel || "") : "" });
    return {
      id: item.id, paymentIds, paymentCount: paymentIds.length, outsideObjective: relatedPurchase?.data().outsideObjective === true, title: String(data.title || "Comprobante"), documentType: cleanExpenseDocumentType(data.documentType), documentDate: String(data.documentDate || ""),
      vendor: String(data.vendor || ""), reference: String(data.reference || ""), notes: String(data.notes || ""), amount: typeof data.amount === "number" ? data.amount : null,
      currency: data.currency === "USD" ? "USD" : "CRC", purchaseId: nullableId(data.purchaseId), purchaseTitle: String(data.purchaseTitle || ""),
      budgetLineIds, budgetLines,
      budgetLineId: nullableId(data.budgetLineId), budgetLineLabel: String(data.budgetLineLabel || ""),
      files: fileIds.flatMap((id) => byId.has(id) ? [mediaJson(byId.get(id)!)] : []), createdAt: expenseIso(data.createdAt), updatedAt: expenseIso(data.updatedAt),
    };
  }).sort((a, b) => (b.documentDate || b.createdAt).localeCompare(a.documentDate || a.createdAt));
  const legacy = await legacyExpenseDocuments(projectId, media);
  for (const document of legacy) {
    const paymentIds = payments.docs.filter((payment) => !payment.data().deletedAt && expensePaymentDocumentIds(payment.data()).includes(document.id)).map((payment) => payment.id);
    documents.push({ ...document, outsideObjective: false, paymentIds, paymentCount: paymentIds.length });
  }
  return { documents, purchases: purchases.docs.filter((item) => !item.data().deletedAt).map((item) => ({ id: item.id, title: String(item.data().title || "Compra"), budgetLineId: nullableId(item.data().budgetLineId) })) };
}

export async function GET() {
  const actor = await requireTabAccess("expenses");
  if (!actor) return NextResponse.json({ error: "Expenses access required" }, { status: 403 });
  return NextResponse.json(await payload(actor.projectId), { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request) {
  const actor = await requireTabAccess("expenses", ["admin", "editor"]);
  if (!actor) return NextResponse.json({ error: "Expenses editor access required" }, { status: 403 });
  const bucket = projectBucket;
  const form = await request.formData();
  const files = [...form.getAll("files"), ...form.getAll("file")].filter((item): item is File => item instanceof File);
  if (files.length && !bucket) return NextResponse.json({ error: "Storage is unavailable" }, { status: 503 });
  if (files.length > 20) return NextResponse.json({ error: "Podés subir hasta 20 archivos a la vez" }, { status: 400 });
  for (const file of files) {
    if (!ALLOWED_TYPES.has(file.type.toLowerCase())) return NextResponse.json({ error: "Los comprobantes deben ser imágenes o PDF" }, { status: 415 });
    if (file.size <= 0 || file.size > 25 * 1024 * 1024) return NextResponse.json({ error: "Cada archivo puede pesar hasta 25 MB" }, { status: 413 });
  }
  const metadata = Object.fromEntries(["title", "documentType", "documentDate", "vendor", "reference", "notes", "amount", "currency", "purchaseId", "budgetLineId"].map((key) => [key, form.get(key)])) as Metadata;
  metadata.budgetLineIds = form.getAll("budgetLineIds");
  const currency = await lockProjectCurrency(actor.projectId);
  const result = await normalize(actor.projectId, metadata, currency, files[0]?.name || "");
  if (result.error) return result.error;
  const folder = files.length ? await ensureExpenseInvoiceFolder(actor.projectId, actor.email) : null;
  const recordRef = firestore.collection(EXPENSE_DOCUMENTS).doc();
  const raw: Array<{ ref: FirebaseFirestore.DocumentReference; objectKey: string; thumbnailObjectKey: string | null; file: File }> = [];
  try {
    for (const file of files) {
      const ref = firestore.collection(DOCUMENTS).doc();
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-");
      const objectKey = `${projectStoragePrefix(actor.projectId)}/invoices/${ref.id}-${safeName}`;
      const bytes = Buffer.from(await file.arrayBuffer());
      await bucket!.file(objectKey).save(bytes, { contentType: file.type, resumable: false, metadata: { metadata: { uploadedBy: actor.email, originalName: file.name } } });
      let thumbnailObjectKey: string | null = null;
      if (IMAGE_TYPES.has(file.type)) {
        thumbnailObjectKey = `${projectStoragePrefix(actor.projectId)}/invoice-thumbnails/${ref.id}.webp`;
        const thumb = await sharp(bytes, { limitInputPixels: 50_000_000 }).rotate().resize(720, 540, { fit: "inside", withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
        await bucket!.file(thumbnailObjectKey).save(thumb, { contentType: "image/webp", resumable: false });
      }
      raw.push({ ref, objectKey, thumbnailObjectKey, file });
    }
    await commitActivity(actor, { category: "expense", action: "expense.document_created", target: { type: "expense_document", id: recordRef.id, label: result.record!.title, section: "expenses" }, summaryParams: { fileCount: raw.length }, changes: [{ field: "comprobante", before: null, after: result.record!.title }] }, (transaction) => {
      for (const item of raw) transaction.set(item.ref, { projectId: actor.projectId, expenseDocumentId: recordRef.id, mediaRole: "financial_document", source: "expense_document", objectKey: item.objectKey, thumbnailObjectKey: item.thumbnailObjectKey, fileName: item.file.name, contentType: item.file.type, size: item.file.size, folderId: folder!.id, uploadedBy: actor.email, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(), deletedAt: null });
      transaction.set(recordRef, { projectId: actor.projectId, ...result.record, fileIds: raw.map((item) => item.ref.id), createdBy: actor.email, createdAt: FieldValue.serverTimestamp(), updatedBy: actor.email, updatedAt: FieldValue.serverTimestamp(), deletedAt: null });
    });
  } catch (error) {
    await Promise.all(raw.flatMap((item) => [bucket!.file(item.objectKey).delete({ ignoreNotFound: true }).catch(() => undefined), item.thumbnailObjectKey ? bucket!.file(item.thumbnailObjectKey).delete({ ignoreNotFound: true }).catch(() => undefined) : Promise.resolve()]));
    throw error;
  }
  return NextResponse.json({ id: recordRef.id, document: (await payload(actor.projectId)).documents.find((item) => item.id === recordRef.id) }, { status: 201 });
}

export async function PATCH(request: Request) {
  const actor = await requireTabAccess("expenses", ["admin", "editor"]);
  if (!actor) return NextResponse.json({ error: "Expenses editor access required" }, { status: 403 });
  const body = await request.json() as Metadata & { id?: string };
  const ref = firestore.collection(EXPENSE_DOCUMENTS).doc(String(body.id || ""));
  const current = await ref.get();
  if (!current.exists || current.data()?.projectId !== actor.projectId || current.data()?.deletedAt) return NextResponse.json({ error: "Comprobante no encontrado" }, { status: 404 });
  await lockProjectCurrency(actor.projectId);
  const result = await normalize(actor.projectId, body, cleanExpenseCurrency(current.data()?.currency));
  if (result.error) return result.error;
  await commitActivity(actor, { category: "expense", action: "expense.document_updated", target: { type: "expense_document", id: ref.id, label: result.record!.title, section: "expenses" }, changes: [{ field: "comprobante", before: current.data()?.title, after: result.record!.title }] }, (transaction) => transaction.set(ref, { ...result.record, updatedBy: actor.email, updatedAt: FieldValue.serverTimestamp() }, { merge: true }));
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const actor = await requireTabAccess("expenses", ["admin", "editor"]);
  if (!actor) return NextResponse.json({ error: "Expenses editor access required" }, { status: 403 });
  const id = new URL(request.url).searchParams.get("id") || "";
  const ref = firestore.collection(EXPENSE_DOCUMENTS).doc(id);
  const current = await ref.get();
  if (!current.exists || current.data()?.projectId !== actor.projectId || current.data()?.deletedAt) return NextResponse.json({ error: "Comprobante no encontrado" }, { status: 404 });
  await lockProjectCurrency(actor.projectId);
  const linkedPayments = await firestore.collection(EXPENSE_PAYMENTS).where("projectId", "==", actor.projectId).get();
  if (linkedPayments.docs.some((payment) => !payment.data().deletedAt && expensePaymentDocumentIds(payment.data()).includes(id)))
    return NextResponse.json({ error: "Desvinculá el comprobante de sus pagos antes de eliminarlo" }, { status: 409 });
  const fileIds = Array.isArray(current.data()?.fileIds) ? current.data()!.fileIds.filter((value: unknown): value is string => typeof value === "string") : [];
  const files = fileIds.length ? await firestore.getAll(...fileIds.map((fileId: string) => firestore.collection(DOCUMENTS).doc(fileId))) : [];
  class ReceiptConflict extends Error {}
  try { await commitActivity(actor, { category: "expense", action: "expense.document_deleted", target: { type: "expense_document", id, label: String(current.data()?.title || "Comprobante"), section: "expenses", exists: false }, changes: [{ field: "deleted", before: false, after: true }] }, (transaction) => {
    transaction.set(ref, { deletedAt: FieldValue.serverTimestamp(), deletedBy: actor.email, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    for (const file of files.filter((item) => item.exists && item.data()?.projectId === actor.projectId)) transaction.set(file.ref, { deletedAt: FieldValue.serverTimestamp(), deletedBy: actor.email, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  }, async (transaction) => {
    const latest = await transaction.get(ref);
    const payments = await transaction.get(firestore.collection(EXPENSE_PAYMENTS).where("projectId", "==", actor.projectId));
    if (!latest.exists || latest.data()?.deletedAt || payments.docs.some((payment) => !payment.data().deletedAt && expensePaymentDocumentIds(payment.data()).includes(id))) throw new ReceiptConflict("Receipt is in use or no longer available");
  }); } catch (error) { if (error instanceof ReceiptConflict) return NextResponse.json({ error: error.message }, { status: 409 }); throw error; }
  return NextResponse.json({ ok: true, recoverable: true });
}
