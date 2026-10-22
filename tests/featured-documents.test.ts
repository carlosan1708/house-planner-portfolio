import { describe, expect, it } from "vitest";
import {
  FEATURED_DOCUMENT_LIMIT, applyFeaturedDocumentsChange, diffFeaturedDocumentIds,
  featuredDocumentId, normalizeFeaturedDocumentIds, parseFeaturedDocumentsChange,
} from "@/lib/featured-documents";

const ids = (count: number) => Array.from({ length: count }, (_, index) => `document-${index}`);

describe("featured document changes", () => {
  it("accepts bounded plain IDs and rejects malformed paths instead of changing their identity", () => {
    for (const id of ["a", "doc-A_9", "x".repeat(200)]) expect(featuredDocumentId(id)).toBe(id);
    for (const id of [null, 1, "", " ", ".", "..", "a/b", "a\\b", "a\n", "a\0b", " padded ", "x".repeat(201)]) expect(featuredDocumentId(id)).toBe("");
  });

  it("normalizes old values without losing valid references beyond the capacity before eligibility checks", () => {
    expect(normalizeFeaturedDocumentIds(null)).toEqual([]);
    expect(normalizeFeaturedDocumentIds({ documentIds: ["a"] })).toEqual([]);
    expect(normalizeFeaturedDocumentIds(["b", null, "a", "b", "invalid/path", "c"])).toEqual(["b", "a", "c"]);
    expect(normalizeFeaturedDocumentIds(ids(31))).toEqual(ids(31));
  });

  it("parses an exact incremental payload, deduplicating each side in input order", () => {
    expect(parseFeaturedDocumentsChange({ addIds: ["b", "a", "b"], removeIds: ["c", "c"] })).toEqual({ addIds: ["b", "a"], removeIds: ["c"] });
    expect(parseFeaturedDocumentsChange({ addIds: [], removeIds: [] })).toEqual({ addIds: [], removeIds: [] });
    expect(parseFeaturedDocumentsChange({ addIds: Array(31).fill("a"), removeIds: [] })).toEqual({ addIds: ["a"], removeIds: [] });
  });

  it.each([
    null, [], {}, { addIds: [] }, { removeIds: [] }, { documentIds: ["a"] },
    { addIds: [], removeIds: [], projectId: "foreign" }, { addIds: "a", removeIds: [] },
    { addIds: [null], removeIds: [] }, { addIds: [], removeIds: ["invalid/path"] },
    { addIds: ["a"], removeIds: ["a"] }, { addIds: ids(31), removeIds: [] },
    { addIds: [], removeIds: ids(31) },
  ])("rejects malformed or conflicting changes %j", value => {
    expect(parseFeaturedDocumentsChange(value)).toBeNull();
  });

  it("retains stored order, appends only new additions in request order and leaves inputs unchanged", () => {
    const current = ["hidden", "a", "b", "a", "c"];
    const change = { addIds: ["b", "e", "d", "e"], removeIds: ["a", "absent"] };
    expect(applyFeaturedDocumentsChange(current, change)).toEqual(["hidden", "b", "c", "e", "d"]);
    expect(current).toEqual(["hidden", "a", "b", "a", "c"]);
    expect(change).toEqual({ addIds: ["b", "e", "d", "e"], removeIds: ["a", "absent"] });
  });

  it("supports retrying the same delta without duplication or reordering and preserves unrelated concurrent additions", () => {
    const change = diffFeaturedDocumentIds(["a", "b"], ["b", "new"]);
    const result = applyFeaturedDocumentsChange(["a", "b", "other-editor"], change);
    expect(result).toEqual(["b", "other-editor", "new"]);
    expect(applyFeaturedDocumentsChange(result, change)).toEqual(result);
  });

  it("enforces the final shared limit atomically after removals, including hidden ordinary references", () => {
    const current = ids(FEATURED_DOCUMENT_LIMIT);
    expect(() => applyFeaturedDocumentsChange(current, { addIds: ["new"], removeIds: [] })).toThrow(RangeError);
    expect(current).toEqual(ids(30));
    expect(applyFeaturedDocumentsChange(current, { addIds: ["new"], removeIds: [current[0]] })).toEqual([...current.slice(1), "new"]);
    expect(() => applyFeaturedDocumentsChange(["a"], { addIds: ["a"], removeIds: ["a"] })).toThrow(TypeError);
  });

  it("computes removals only from the caller's visible opening baseline and preserves selected order", () => {
    const savedVisible = ["a", "b", "a"];
    const draft = ["b", "d", "c", "d"];
    const change = diffFeaturedDocumentIds(savedVisible, draft);
    expect(change).toEqual({ addIds: ["d", "c"], removeIds: ["a"] });
    expect(applyFeaturedDocumentsChange(["hidden", "a", "b", "stale-file-payload"], change)).toEqual(["hidden", "b", "stale-file-payload", "d", "c"]);
    expect(diffFeaturedDocumentIds(["a", "b"], ["b", "a"])).toEqual({ addIds: [], removeIds: [] });
  });
});
