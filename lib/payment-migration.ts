import { createHash } from "node:crypto";
import { projectCurrency, type ProjectCurrency } from "./currency";
import type { WorkbookPayment } from "./payment-workbook";

type MigrationLine = { id: string; item: string; paid: number; outsideObjective?: boolean };
type MigrationSource = { objectKey: string; generation: string; sha256: string; planVersion: number; actualsRevision: number };

const cents = (value: unknown) => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1e12) throw new Error("Importe de migración inválido");
  return Math.round(value * 100);
};
const fingerprint = (value: unknown): string => {
  const stable = (item: unknown): unknown => Array.isArray(item) ? item.map(stable) : item && typeof item === "object"
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, stable(child)])) : item;
  return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
};

/** Pure, reviewable plan. It performs no reads, writes or automatic activation. */
export function planPaymentMigration(input: {
  projectId: string; currency?: ProjectCurrency; source: MigrationSource; lines: MigrationLine[]; payments: WorkbookPayment[];
  corrections?: Array<{ lineId: string; expectedLegacyPaid: number; expectedRecordedPaid: number; targetPaid: number; reason: string }>;
}) {
  if (!input.projectId || !input.source.objectKey || !input.source.generation || !/^[a-f0-9]{64}$/.test(input.source.sha256)) throw new Error("Falta la versión exacta del archivo revisado");
  const currency = input.currency || "CRC";
  const ids = new Set<string>();
  for (const line of input.lines) { if (!line.id || ids.has(line.id)) throw new Error("Identificadores de partida duplicados"); ids.add(line.id); cents(line.paid); }
  const paymentIds = new Set<string>();
  for (const payment of input.payments) {
    if (!payment.id || paymentIds.has(payment.id)) throw new Error("Identificadores de pago duplicados");
    if (payment.projectId && payment.projectId !== input.projectId) throw new Error("El pago pertenece a otro proyecto");
    paymentIds.add(payment.id);
    if (!payment.deletedAt && payment.budgetLineId && !ids.has(String(payment.budgetLineId))) throw new Error("Hay un pago asignado a una partida ausente; conciliá sus vínculos antes de migrar");
    if (!payment.deletedAt && projectCurrency(payment.currency) !== currency) throw new Error("La moneda de un pago no coincide con el proyecto");
    if (!payment.deletedAt && cents(payment.amount) <= 0) throw new Error("Hay un pago activo sin importe válido");
  }
  const corrections = new Map((input.corrections || []).map((correction) => [correction.lineId, correction]));
  if (corrections.size !== (input.corrections || []).length || [...corrections.keys()].some((id) => !ids.has(id))) throw new Error("Corrección de migración inválida");
  const sourceFingerprint = fingerprint({ projectId: input.projectId, currency, source: input.source, lines: input.lines, payments: [...input.payments].sort((a, b) => a.id.localeCompare(b.id)) });
  const imports: WorkbookPayment[] = [];
  const lines = input.lines.map((line) => {
    const active = input.payments.filter((payment) => !payment.deletedAt && payment.budgetLineId === line.id);
    const recorded = active.reduce((sum, payment) => sum + cents(payment.amount), 0);
    const ledger = active.reduce((sum, payment) => sum + (payment.accountingMode === "ledger" ? cents(payment.amount) : 0), 0);
    const legacy = cents(line.paid) + ledger;
    const correction = corrections.get(line.id);
    let target = legacy;
    if (correction) {
      if (!correction.reason.trim() || cents(correction.expectedLegacyPaid) !== legacy || cents(correction.expectedRecordedPaid) !== recorded) throw new Error(`La partida ${line.item} cambió desde la revisión`);
      target = cents(correction.targetPaid);
    }
    if (target < recorded) throw new Error(`El total de ${line.item} no puede eliminar pagos existentes`);
    const gap = target - recorded;
    if (gap) imports.push({ id: `excel-${fingerprint({ sourceFingerprint, lineId: line.id }).slice(0, 48)}`, projectId: input.projectId, currency,
      budgetLineId: line.id, budgetLineLabel: line.item, amount: gap / 100, accountingMode: "ledger", source: "excel-import",
      sourceObjectKey: input.source.objectKey, sourceGeneration: input.source.generation, importFingerprint: sourceFingerprint,
      purchaseId: null, purchaseTitle: "", paymentKind: "partial", paymentDate: "", payee: "", reference: "", notes: "",
      documentIds: [], documents: [], documentId: null, documentTitle: "", documentType: null, deletedAt: null });
    return { id: line.id, item: line.item, outsideObjective: line.outsideObjective === true, legacyPaid: legacy / 100,
      recordedPaid: recorded / 100, importAmount: gap / 100, paid: target / 100, correctionReason: correction?.reason || null };
  });
  const totals = lines.reduce((sum, line) => ({ legacyPaid: sum.legacyPaid + cents(line.legacyPaid), recordedPaid: sum.recordedPaid + cents(line.recordedPaid),
    importedPaid: sum.importedPaid + cents(line.importAmount), paid: sum.paid + cents(line.paid) }), { legacyPaid: 0, recordedPaid: 0, importedPaid: 0, paid: 0 });
  const manifest = { paymentsModelVersion: 2 as const, projectId: input.projectId, currency, source: input.source, sourceFingerprint,
    preservedPaymentIds: input.payments.map((payment) => payment.id).sort(), imports, lines,
    totals: Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, value / 100])) as typeof totals };
  return { ...manifest, manifestSha256: fingerprint(manifest) };
}
