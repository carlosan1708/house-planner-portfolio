export const FEATURED_DOCUMENT_LIMIT = 30;

export type FeaturedDocumentsChange = { addIds: string[]; removeIds: string[] };

export function featuredDocumentId(value: unknown): string {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{1,200}$/.test(value) ? value : "";
}

/** Do not truncate stored IDs before the server has checked structural eligibility. */
export function normalizeFeaturedDocumentIds(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.map(featuredDocumentId).filter(Boolean))] : [];
}

export function parseFeaturedDocumentsChange(value: unknown): FeaturedDocumentsChange | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const keys = Object.keys(input);
  if (keys.length !== 2 || !keys.includes("addIds") || !keys.includes("removeIds")) return null;
  const change: FeaturedDocumentsChange = { addIds: [], removeIds: [] };
  for (const key of ["addIds", "removeIds"] as const) {
    const ids = input[key];
    if (!Array.isArray(ids) || ids.some(id => !featuredDocumentId(id))) return null;
    change[key] = normalizeFeaturedDocumentIds(ids);
    if (change[key].length > FEATURED_DOCUMENT_LIMIT) return null;
  }
  const removed = new Set(change.removeIds);
  return change.addIds.some(id => removed.has(id)) ? null : change;
}

export function applyFeaturedDocumentsChange(current: readonly string[], change: FeaturedDocumentsChange): string[] {
  const parsed = parseFeaturedDocumentsChange(change);
  if (!parsed) throw new TypeError("Invalid featured document change");
  const removed = new Set(parsed.removeIds);
  const result = normalizeFeaturedDocumentIds([
    ...normalizeFeaturedDocumentIds(current).filter(id => !removed.has(id)),
    ...parsed.addIds,
  ]);
  if (result.length > FEATURED_DOCUMENT_LIMIT) throw new RangeError("Choose up to 30 featured documents");
  return result;
}

/** Compare only the visible opening baseline; callers preserve unavailable saved IDs. */
export function diffFeaturedDocumentIds(saved: readonly string[], draft: readonly string[]): FeaturedDocumentsChange {
  const previous = normalizeFeaturedDocumentIds(saved), next = normalizeFeaturedDocumentIds(draft);
  const previousIds = new Set(previous), nextIds = new Set(next);
  return { addIds: next.filter(id => !previousIds.has(id)), removeIds: previous.filter(id => !nextIds.has(id)) };
}
