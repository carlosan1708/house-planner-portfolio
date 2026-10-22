export type BudgetProgressStatus = "Completada" | "En progreso" | "Pendiente";

export const BUDGET_PROGRESS_APPEARANCE: Record<BudgetProgressStatus, { row: string; cell: string; text: string }> = {
  Completada: { row: "#EAF4E2", cell: "#C6E0B4", text: "#375623" },
  "En progreso": { row: "#FFF4CC", cell: "#FFE699", text: "#7F6000" },
  Pendiente: { row: "#F7F7F7", cell: "#F2F2F2", text: "#666666" },
};

export function normalizeBudgetProgressStatus(value: unknown): BudgetProgressStatus {
  const normalized = String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
  if (["completada", "completado", "completed", "done", "comprado", "pagado"].includes(normalized)) return "Completada";
  if (["en progreso", "in progress", "ongoing", "cotizado"].includes(normalized)) return "En progreso";
  return "Pendiente";
}
