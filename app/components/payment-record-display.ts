import type { ExpensePaymentRecord } from "@/lib/expense-records";

type DisplayPayment = ExpensePaymentRecord & { source?: string; sourceLabel?: string };

export const isExcelImportedPayment = (payment: DisplayPayment) => payment.source === "excel-import";

export function paymentRecordTitle(payment: DisplayPayment, language: "en" | "es", fallback?: string) {
  return payment.payee || (payment.source === "excel-import"
    ? language === "es" ? "Pago de Excel sin detalle" : "Excel payment without details"
    : payment.reference || fallback || (language === "es" ? "Pago" : "Payment"));
}

export function paymentRecordKind(payment: DisplayPayment, language: "en" | "es") {
  if (payment.source === "excel-import") return language === "es" ? "Importado de Excel" : "Imported from Excel";
  if (payment.paymentKind === "settlement") return payment.purchaseId
    ? language === "es" ? "Pago de saldo" : "Balance payment"
    : language === "es" ? "Pago total" : "Full payment";
  return language === "es" ? "Abono" : "Installment";
}
