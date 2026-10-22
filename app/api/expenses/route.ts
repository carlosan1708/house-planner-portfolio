import { lockProjectCurrency } from "@/lib/project-currency";
import { projectCurrency } from "@/lib/currency";
import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { requireTabAccess } from "@/lib/auth";
import { firestore } from "@/lib/firebase-admin";
import { aggregateExpenses, deriveExpensesFromBudgetLines, type ExpenseAttachmentLink } from "@/lib/expenses";
import { findExpenseInvoiceFolder, listProjectFolders } from "@/lib/folders";
import { DOCUMENTS, EXPENSES } from "@/lib/project";
import { budgetPayload, getExpenseAttachmentLinks } from "@/lib/workbook-store";
import { commitActivity } from "@/lib/activity";

const isImage = (contentType: unknown) => String(contentType || "").toLowerCase().startsWith("image/");
const isAudio = (contentType: unknown) => String(contentType || "").toLowerCase().startsWith("audio/");
const iso = (value: unknown) => value && typeof value === "object" && "toDate" in value
  ? (value as FirebaseFirestore.Timestamp).toDate().toISOString()
  : "";

async function expensePayload(projectId: string) {
  const [budget, storedLinks, folders] = await Promise.all([budgetPayload(projectId, { skipGoogleSync: true }), getExpenseAttachmentLinks(projectId), listProjectFolders(projectId)]);
  const invoiceFolder = findExpenseInvoiceFolder(folders);
  const documentIds = [...new Set(storedLinks.filter((link) => !link.deletedAt).map((link) => link.documentId))];
  const snapshots = documentIds.length
    ? await firestore.getAll(...documentIds.map((id) => firestore.collection(DOCUMENTS).doc(id)))
    : [];
  const documents = new Map(snapshots.flatMap((snapshot) => {
    const data = snapshot.data();
    if (!snapshot.exists || !data || data.projectId !== projectId || data.deletedAt || data.folderId !== invoiceFolder?.id) return [];
    return [[snapshot.id, data] as const];
  }));
  const links: ExpenseAttachmentLink[] = storedLinks.flatMap((link) => {
    const document = documents.get(link.documentId);
    if (!document) return [];
    const contentType = String(document.contentType || "application/octet-stream");
    return [{
      id: link.id,
      budgetLineId: link.budgetLineId,
      documentId: link.documentId,
      fileName: String(document.fileName || "Comprobante"),
      contentType,
      createdAt: link.createdAt || iso(document.createdAt),
      deletedAt: link.deletedAt,
      isImage: isImage(contentType),
      isAudio: isAudio(contentType),
      note: String(link.note || "").slice(0, 500),
    }];
  });
  const expenses = deriveExpensesFromBudgetLines(budget.lines, links);
  return {
    expenses, currency: projectCurrency(budget.currency),
    summary: aggregateExpenses(expenses),
    budgetLines: budget.lines,
    paymentsModelVersion: budget.paymentsModelVersion,
    paymentLedgerRevision: budget.paymentLedgerRevision,
    source: "workbook" as const,
  };
}

export async function GET() {
  const actor = await requireTabAccess("expenses");
  if (!actor) return NextResponse.json({ error: "Expense access required" }, { status: 403 });
  return NextResponse.json(await expensePayload(actor.projectId));
}

export async function POST(request: Request) {
  const actor = await requireTabAccess("expenses", ["admin", "editor"]);
  if (!actor) return NextResponse.json({ error: "Expenses editor access required" }, { status: 403 });
  const body = await request.json() as { budgetLineId?: string; receiptDocumentId?: string };
  const budgetLineId = String(body.budgetLineId || "");
  const receiptDocumentId = String(body.receiptDocumentId || "");
  if (!budgetLineId || !receiptDocumentId) return NextResponse.json({ error: "A paid budget line and receipt are required" }, { status: 400 });
  const currency = await lockProjectCurrency(actor.projectId);
  const budget = await budgetPayload(actor.projectId, { skipGoogleSync: true });
  const line = budget.lines.find((item) => item.id === budgetLineId && item.paid > 0);
  if (!line) return NextResponse.json({ error: "This line has no paid price in the workbook" }, { status: 400 });
  const receipt = await firestore.collection(DOCUMENTS).doc(receiptDocumentId).get();
  if (!receipt.exists || receipt.data()?.projectId !== actor.projectId || receipt.data()?.deletedAt)
    return NextResponse.json({ error: "Receipt document not found" }, { status: 400 });
  const invoiceFolder = findExpenseInvoiceFolder(await listProjectFolders(actor.projectId));
  if (!invoiceFolder || receipt.data()?.folderId !== invoiceFolder.id)
    return NextResponse.json({ error: "Only files in the Factura folder can be linked" }, { status: 400 });
  const existing = (await getExpenseAttachmentLinks(actor.projectId)).find((link) => !link.deletedAt && link.budgetLineId === budgetLineId && link.documentId === receiptDocumentId);
  if (existing) return NextResponse.json({ id: existing.id, linked: true, duplicate: true });
  const ref = firestore.collection(EXPENSES).doc();
  const record = {
    projectId: actor.projectId,
    kind: "workbook_receipt_link",
    budgetLineId,
    receiptDocumentId,
    amountSnapshot: line.paid, currency,
    descriptionSnapshot: line.item,
    createdBy: actor.email,
    createdAt: FieldValue.serverTimestamp(),
    updatedBy: actor.email,
    updatedAt: FieldValue.serverTimestamp(),
    deletedAt: null,
  };
  await commitActivity(actor, {
    category: "expense", action: "expense.receipt_linked",
    target: { type: "expense", id: budgetLineId, label: line.item, section: "expenses" },
    summaryParams: { fileName: String(receipt.data()?.fileName || "Comprobante"), amount: line.paid },
    changes: [{ field: "receipt", before: null, after: String(receipt.data()?.fileName || receiptDocumentId), format: "text" }, { field: "amount", before: line.paid, after: line.paid, format: currency === "USD" ? "currency_usd" : "currency_crc" }],
  }, (transaction) => transaction.set(ref, record));
  return NextResponse.json({ id: ref.id, linked: true }, { status: 201 });
}

async function unlink(id: string, actor: NonNullable<Awaited<ReturnType<typeof requireTabAccess>>>) {
  if (!id) return NextResponse.json({ error: "Attachment link is required" }, { status: 400 });
  const ref = firestore.collection(EXPENSES).doc(id);
  const snapshot = await ref.get();
  if (!snapshot.exists || snapshot.data()?.projectId !== actor.projectId || snapshot.data()?.deletedAt)
    return NextResponse.json({ error: "Attachment link not found" }, { status: 404 });
  const data = snapshot.data()!;
  const receipt = data.receiptDocumentId ? await firestore.collection(DOCUMENTS).doc(String(data.receiptDocumentId)).get() : null;
  const fileName = String(receipt?.data()?.fileName || "Comprobante");
  await commitActivity(actor, {
    category: "expense", action: "expense.receipt_unlinked",
    target: { type: "expense", id: String(data.budgetLineId || id), label: String(data.descriptionSnapshot || "Gasto"), section: "expenses" },
    summaryParams: { fileName, amount: Number(data.amountSnapshot || 0) },
    changes: [{ field: "receipt", before: fileName, after: null, format: "text" }],
  }, (transaction) => transaction.set(ref, { deletedAt: FieldValue.serverTimestamp(), deletedBy: actor.email, updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.email }, { merge: true }));
  return NextResponse.json({ ok: true, unlinked: true, documentPreserved: true });
}

export async function DELETE(request: Request) {
  const actor = await requireTabAccess("expenses", ["admin", "editor"]);
  if (!actor) return NextResponse.json({ error: "Expenses editor access required" }, { status: 403 });
  return unlink(new URL(request.url).searchParams.get("id") || "", actor);
}

export async function PATCH(request: Request) {
  const actor = await requireTabAccess("expenses", ["admin", "editor"]);
  if (!actor) return NextResponse.json({ error: "Expenses editor access required" }, { status: 403 });
  const body = await request.json() as { id?: string; action?: string };
  if (body.action !== "delete" && body.action !== "unlink")
    return NextResponse.json({ error: "Amounts are managed only through Price paid in the workbook" }, { status: 400 });
  return unlink(String(body.id || ""), actor);
}
