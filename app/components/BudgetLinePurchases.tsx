"use client";

import { buildWorkspacePath } from "@/lib/workspace-navigation";
import "./budget-line-purchases.css";

export default function BudgetLinePurchases({ projectId, lineId, item, language, canCreate = false, demo = false, unpaid = false }: {
  projectId: string; lineId: string; item: string; language: "en" | "es"; canCreate?: boolean; demo?: boolean; unpaid?: boolean;
}) {
  const es = language === "es";
  const params = new URLSearchParams({ budgetLine: lineId, expenseTab: "documents" });
  if (demo) params.set("mode", "demo");
  const path = buildWorkspacePath({ projectId, section: "expenses", budgetScope: null });
  const href = `${path}?${params}`;
  return <details className="budget-line-purchases">
    <summary aria-label={`${es ? "Compras y comprobantes de" : "Purchases and receipts for"} ${item}`}>{es ? "Compras y comprobantes" : "Purchases and receipts"}</summary>
    <nav aria-label={`${es ? "Vínculos de" : "Links for"} ${item}`}>
      <a href={href} target="_blank" rel="noopener noreferrer" aria-label={es ? `Ver compras y comprobantes de ${item} (otra pestaña)` : `View purchases and receipts for ${item} (new tab)`}>{es ? "Ver compras y comprobantes" : "View purchases and receipts"} <span aria-hidden="true">↗</span></a>
      {canCreate && <a href={`${href}&newExpense=1`} target="_blank" rel="noopener noreferrer" aria-label={es ? `Registrar compra para ${item} (otra pestaña)` : `Record purchase for ${item} (new tab)`}>{es ? "Registrar compra" : "Record purchase"} <span aria-hidden="true">↗</span></a>}
      {canCreate && <a href={`${href.replace("expenseTab=documents", "expenseTab=payments")}&newPayment=1`} target="_blank" rel="noopener noreferrer">{es ? "Registrar pago" : "Record payment"} ↗</a>}
      {canCreate && <a href={`${href}&newDocument=1`} target="_blank" rel="noopener noreferrer">{es ? "Crear comprobante" : "Create receipt"} ↗</a>}
      {unpaid && <small>{es ? "Podés registrar el primer pago directamente; el acumulado se calcula automáticamente." : "Record the first payment directly; the total is calculated automatically."}</small>}
      <small>{es ? "Se abre en otra pestaña." : "Opens in a new tab."}</small>
    </nav>
  </details>;
}
