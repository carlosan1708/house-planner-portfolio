export type ExpenseAttachment = {
  id: string;
  documentId: string;
  fileName: string;
  contentType: string;
  createdAt: string;
  isImage: boolean;
  isAudio?: boolean;
  note?: string;
};

export type ExpenseAttachmentLink = ExpenseAttachment & {
  budgetLineId: string;
  deletedAt?: string | null;
};

export type ExpenseRecord = {
  id: string;
  paymentDate: string;
  vendor: string;
  description: string;
  reference: string;
  amount: number;
  budgetLineId: string;
  outsideObjective?: boolean;
  chapter: string;
  type: string;
  subcategory: string;
  paymentMethod: string;
  notes: string;
  status: "paid";
  receiptDocumentId: string | null;
  attachments: ExpenseAttachment[];
  source: "workbook";
};

type BudgetExpenseLine = {
  outsideObjective?: boolean;
  id: string;
  chapter: string;
  item: string;
  type: string;
  subcategory: string;
  paid: number;
  supplier: string;
};

export function deriveExpensesFromBudgetLines(lines: BudgetExpenseLine[], links: ExpenseAttachmentLink[] = []): ExpenseRecord[] {
  const activeLinks = links.filter((link) => !link.deletedAt);
  return lines.filter((line) => Number.isFinite(line.paid) && line.paid > 0).map((line) => {
    const attachments = activeLinks
      .filter((link) => link.budgetLineId === line.id)
      .map((link) => ({ id: link.id, documentId: link.documentId, fileName: link.fileName, contentType: link.contentType, createdAt: link.createdAt, isImage: link.isImage, isAudio: link.isAudio, note: link.note }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return {
      id: line.id,
      paymentDate: attachments[0]?.createdAt?.slice(0, 10) || "",
      vendor: line.supplier || "Unassigned",
      description: line.item,
      reference: "",
      amount: line.paid,
      budgetLineId: line.id, outsideObjective: line.outsideObjective === true,
      chapter: line.chapter,
      type: line.type,
      subcategory: line.subcategory,
      paymentMethod: "",
      notes: "",
      status: "paid" as const,
      receiptDocumentId: attachments[0]?.documentId || null,
      attachments,
      source: "workbook" as const,
    };
  }).sort((a, b) => b.amount - a.amount || a.description.localeCompare(b.description));
}

export function aggregateExpenses(expenses: ExpenseRecord[]) {
  const sum = (items: ExpenseRecord[]) => items.reduce((total, expense) => total + expense.amount, 0);
  const group = (get: (expense: ExpenseRecord) => string) => Object.values(expenses.reduce<Record<string, ExpenseRecord[]>>((result, expense) => {
    const label = get(expense) || "Unassigned";
    (result[label] ||= []).push(expense);
    return result;
  }, {})).map((items) => ({ label: get(items[0]) || "Unassigned", total: sum(items), count: items.length })).sort((a, b) => b.total - a.total);
  return {
    total: sum(expenses),
    byMonth: group((expense) => expense.paymentDate ? expense.paymentDate.slice(0, 7) : "Unassigned").sort((a, b) => b.label.localeCompare(a.label)),
    byVendor: group((expense) => expense.vendor),
    byChapter: group((expense) => expense.chapter),
    byCategory: group((expense) => expense.subcategory),
    byBudgetLine: group((expense) => expense.budgetLineId),
  };
}
