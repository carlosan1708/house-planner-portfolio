import type { BudgetLine } from "./workbook";

export const ASSISTANT_EDITABLE_FIELDS = [
  "chapter", "item", "type", "subcategory", "objective", "quote", "paid", "supplier",
] as const;

export type AssistantEditableField = (typeof ASSISTANT_EDITABLE_FIELDS)[number];
export type AssistantLanguage = "en" | "es";
export type AssistantCitation = {
  id: string;
  kind: "budget" | "document" | "note";
  label: string;
  href?: string;
  budgetLineId?: string;
  documentId?: string;
};
export type BudgetMatch = BudgetLine & { score: number; matchedOn: string[] };
export type BudgetProposalChange = {
  lineId: string;
  row: number;
  field: AssistantEditableField;
  before: string | number;
  after: string | number;
  reason: string;
  label: string;
};
export type AssistantProposal = {
  id: string;
  status: "pending" | "confirmed" | "expired" | "cancelled";
  basePlanVersion: number;
  changes: BudgetProposalChange[];
  summary: string;
  draftId?: string;
};
export type AssistantMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: string;
  citations?: AssistantCitation[];
  proposal?: AssistantProposal | null;
};

export const ASSISTANT_FIELD_COLUMNS: Record<AssistantEditableField, number> = {
  chapter: 1,
  item: 2,
  type: 3,
  subcategory: 4,
  objective: 5,
  quote: 7,
  paid: 10,
  supplier: 11,
};

export function normalizeAssistantText(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
function tokens(value: unknown) {
  return [...new Set(normalizeAssistantText(value).split(/\s+/).filter((token) => token.length > 1))];
}

export function detectAssistantLanguage(message: string, fallback: AssistantLanguage = "en"): AssistantLanguage {
  const normalized = ` ${normalizeAssistantText(message)} `;
  const spanish = [" el ", " la ", " los ", " las ", " presupuesto ", " documento ", " cambia ", " cambiar ", " cuanto ", " cual ", " donde ", " necesito ", " buscar ", " contrato ", " cotizacion "].filter((word) => normalized.includes(word)).length;
  const english = [" the ", " budget ", " document ", " change ", " find ", " how ", " what ", " where ", " need ", " contract ", " quote "].filter((word) => normalized.includes(word)).length;
  if (spanish === english) return fallback;
  return spanish > english ? "es" : "en";
}

export function searchBudgetLines(
  lines: BudgetLine[],
  query: string,
  options: { amount?: number; chapter?: string; type?: string; supplier?: string; limit?: number } = {},
): BudgetMatch[] {
  const queryTokens = tokens(query);
  const normalizedQuery = normalizeAssistantText(query);
  const constraints = {
    chapter: normalizeAssistantText(options.chapter),
    type: normalizeAssistantText(options.type),
    supplier: normalizeAssistantText(options.supplier),
  };
  return lines.map((line) => {
    const fields: Array<[string, unknown, number]> = [
      ["item", line.item, 5], ["subcategory", line.subcategory, 3], ["chapter", line.chapter, 2.5],
      ["type", line.type, 2], ["supplier", line.supplier, 2], ["status", line.status, 1],
    ];
    let score = 0;
    const matchedOn: string[] = [];
    for (const [name, value, weight] of fields) {
      const normalized = normalizeAssistantText(value);
      if (!normalized) continue;
      const matched = queryTokens.filter((token) => normalized.includes(token)).length;
      if (matched) {
        score += matched * weight;
        matchedOn.push(name);
      }
      if (normalizedQuery.length > 2 && normalized.includes(normalizedQuery)) score += weight * 3;
    }
    if (constraints.chapter && !normalizeAssistantText(line.chapter).includes(constraints.chapter)) score -= 20;
    if (constraints.type && !normalizeAssistantText(line.type).includes(constraints.type)) score -= 20;
    if (constraints.supplier && !normalizeAssistantText(line.supplier).includes(constraints.supplier)) score -= 20;
    if (typeof options.amount === "number" && Number.isFinite(options.amount)) {
      const amounts = [line.objective, line.quote, line.paid];
      const closest = Math.min(...amounts.map((amount) => Math.abs(amount - options.amount!)));
      if (closest === 0) { score += 8; matchedOn.push("amount"); }
      else if (closest <= Math.max(1, Math.abs(options.amount) * 0.03)) { score += 4; matchedOn.push("amount"); }
    }
    return { ...line, score, matchedOn: [...new Set(matchedOn)] };
  }).filter((line) => line.score > 0).sort((a, b) => b.score - a.score || a.row - b.row).slice(0, options.limit ?? 8);
}

export function validateProposalChanges(
  lines: BudgetLine[],
  requested: Array<{ lineId?: unknown; field?: unknown; value?: unknown; reason?: unknown }>,
): BudgetProposalChange[] {
  if (!Array.isArray(requested) || requested.length < 1 || requested.length > 20) throw new Error("invalid_changes");
  const byId = new Map(lines.map((line) => [line.id, line]));
  return requested.map((change) => {
    const lineId = String(change.lineId ?? "");
    const field = String(change.field ?? "") as AssistantEditableField;
    const line = byId.get(lineId);
    if (!line || !ASSISTANT_EDITABLE_FIELDS.includes(field)) throw new Error("invalid_change_target");
    const numeric = ["objective", "quote", "paid"].includes(field);
    const value = numeric ? Number(change.value) : String(change.value ?? "").trim();
    if (numeric && (!Number.isFinite(value) || Number(value) < 0 || Number(value) > 10_000_000_000)) throw new Error("invalid_change_value");
    if (!numeric && (!value || String(value).length > 500)) throw new Error("invalid_change_value");
    const before = line[field];
    return {
      lineId,
      row: line.row,
      field,
      before,
      after: value,
      reason: String(change.reason ?? "").trim().slice(0, 500),
      label: `${line.chapter} · ${line.item}`,
    };
  });
}
