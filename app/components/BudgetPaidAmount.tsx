"use client";

import "./budget-payments.css";

export default function BudgetPaidAmount({ amount, item, language, currency = "CRC", onRegisterPayment, unpublished = false, showLabel = false }: {
  amount: number; item: string; language: "en" | "es"; currency?: "CRC" | "USD"; onRegisterPayment?: () => void; unpublished?: boolean; showLabel?: boolean;
}) {
  const es = language === "es";
  return <div className="budget-paid-control">
    {showLabel && <small>{es ? "Pagado" : "Paid"}</small>}
    <output aria-live="off" className="budget-paid-amount" aria-label={`${item} ${es ? "Pagado" : "Paid"}`}>{new Intl.NumberFormat(es ? "es-CR" : "en-US", { style: "currency", currency, maximumFractionDigits: Number.isInteger(amount) ? 0 : 2 }).format(amount)}</output>
    {onRegisterPayment && <button type="button" className="budget-payment-button" onClick={onRegisterPayment}>{es ? "Registrar abono o pago" : "Record partial or full payment"}</button>}
    {unpublished && <small>{es ? "Guarda y aplica la partida para registrar un pago." : "Save and apply the item to record a payment."}</small>}
  </div>;
}
