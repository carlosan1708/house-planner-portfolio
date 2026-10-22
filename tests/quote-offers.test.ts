import { expect, it } from "vitest";
import { parseOfferAssignments } from "@/lib/quote-offers";
import { normalizeQuoteAnalysis } from "@/lib/quote-analysis";

it("keeps three competing offers separate, including attachments within one offer", () => {
  expect(parseOfferAssignments([
    { supplier: " A ", fileIndexes: [0, 1] },
    { supplier: "B", fileIndexes: [2] },
    { supplier: "C", fileIndexes: [3] },
  ], 4).map(offer => [offer.supplier, offer.fileIndexes])).toEqual([["A", [0, 1]], ["B", [2]], ["C", [3]]]);
});

it("rejects ambiguous ownership, missing files and duplicate suppliers", () => {
  for (const offers of [
    [{ supplier: "A", fileIndexes: [0] }, { supplier: "B", fileIndexes: [0, 1] }],
    [{ supplier: "A", fileIndexes: [0] }],
    [{ supplier: "A", fileIndexes: [0] }, { supplier: "a", fileIndexes: [1] }],
    [{ supplier: "A", fileIndexes: [0, 2] }],
  ]) expect(() => parseOfferAssignments(offers, 2)).toThrow();
  expect(parseOfferAssignments(null, 2)[0].fileIndexes).toEqual([0, 1]);
});

it("preserves supplier-specific totals and documentary evidence without inventing missing values", () => {
  const result = normalizeQuoteAnalysis({ offerComparison: {
    suppliers: [{ supplier: "A", total: "CRC 100", scope: "Materials", caveats: "Tax not stated" }, { supplier: "B", total: "CRC 120", scope: "Installed", caveats: "" }],
    rows: [{ item: "Installation", values: [{ supplier: "A", detail: "Not stated", evidence: "A.pdf p1" }, { supplier: "B", detail: "Included", evidence: "B.pdf p2" }], conclusion: "Totals have different scopes" }],
  } });
  expect(result.offerComparison?.suppliers.map(item => item.total)).toEqual(["CRC 100", "CRC 120"]);
  expect(result.offerComparison?.rows[0].values[0].detail).toBe("Not stated");
  expect(result.offerComparison?.rows[0].values[1].evidence).toBe("B.pdf p2");
});
