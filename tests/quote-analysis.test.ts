import { describe, expect, it } from "vitest";
import { normalizeQuoteAnalysis } from "@/lib/quote-analysis";

describe("quote analysis output", () => {
  it("keeps concise structured findings and drops malformed entries", () => {
    const result = normalizeQuoteAnalysis({
      summary: "  Review this price.  ",
      recommendation: "Ask before accepting",
      essentialQuestions: [{ question: "Does it include tax?", reason: "The quote is silent" }, { reason: "invalid" }],
      mainRisks: [{ risk: "No warranty", impact: "Future cost", evidence: "No warranty clause found" }],
      scopeFindings: "invalid",
      budgetComparison: [{ item: "Tile", quoted: "₡120", budget: "₡100", difference: "+₡20" }],
      planFindings: [{ reference: "Plan A", finding: "Area differs" }],
      missingInformation: ["Tax", null],
      priceSearchTerms: ["porcelain tile Costa Rica"],
    });
    expect(result.summary).toBe("Review this price.");
    expect(result.essentialQuestions).toHaveLength(1);
    expect(result.scopeFindings).toEqual([]);
    expect(result.missingInformation).toEqual(["Tax"]);
    expect(result.priceSearchTerms).toEqual(["porcelain tile Costa Rica"]);
  });
});
