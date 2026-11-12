import { cleanExpenseAmount, cleanExpenseDate, cleanExpenseNotes, cleanExpenseText } from "./expense-records";
import { projectCurrency, type ProjectCurrency } from "./currency";

export type PaymentReminder = {
  id: string;
  description: string;
  amount: number | null;
  currency: ProjectCurrency;
  dueDate: string;
  vendor: string;
  notes: string;
  status: "pending" | "done";
  revision: number;
};

export const isPaymentReminder = (data: Record<string, unknown>) =>
  (data.kind === "payment_reminder" || data.kind === "transaction") && !data.deletedAt && data.status !== "void";

export function paymentReminder(id: string, data: Record<string, unknown>): PaymentReminder {
  return {
    id, description: cleanExpenseText(data.description, 300), amount: cleanExpenseAmount(data.amount),
    // Old manual entries were denominated in CRC, even in a project later set to USD.
    currency: projectCurrency(data.currency), dueDate: cleanExpenseDate(data.dueDate),
    vendor: cleanExpenseText(data.vendor, 200), notes: cleanExpenseNotes(data.notes),
    status: data.reminderStatus === "done" ? "done" : "pending",
    revision: Number.isSafeInteger(data.reminderRevision) && Number(data.reminderRevision) >= 0 ? Number(data.reminderRevision) : 0,
  };
}

export function reminderFields(body: Record<string, unknown>) {
  const description = cleanExpenseText(body.description, 300);
  if (!description) throw new Error("La descripción es obligatoria.");
  if (body.amount !== null && body.amount !== undefined && body.amount !== "" && typeof body.amount !== "number" && typeof body.amount !== "string") throw new Error("El importe no es válido.");
  const amount = cleanExpenseAmount(body.amount);
  if (body.amount !== null && body.amount !== undefined && body.amount !== "" && amount === null) throw new Error("El importe no es válido.");
  if (body.currency !== "CRC" && body.currency !== "USD") throw new Error("La moneda no es válida.");
  const dueDate = cleanExpenseDate(body.dueDate);
  if (body.dueDate && !dueDate) throw new Error("La fecha prevista no es válida.");
  return { description, amount, currency: body.currency as ProjectCurrency, dueDate, vendor: cleanExpenseText(body.vendor, 200), notes: cleanExpenseNotes(body.notes) };
}
