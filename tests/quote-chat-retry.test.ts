import { describe, expect, it, vi } from "vitest";

const generateContent = vi.hoisted(() => vi.fn().mockResolvedValue({ text: "The offers differ in scope." }));
vi.mock("@/lib/gemini", () => ({
  assistantModel: () => "gemini-test",
  geminiConfigured: () => true,
  geminiClient: () => ({ models: { generateContent } }),
}));

import { answerQuoteQuestion } from "@/lib/quote-analysis";

describe("quote chat retry", () => {
  it("limits retries to one additional request and only for a 429", async () => {
    const result = await answerQuoteQuestion({
      language: "en", question: "Compare these offers", analysis: {
        summary: "Review", recommendation: "Review", essentialQuestions: [], mainRisks: [], scopeFindings: [],
        budgetComparison: [], planFindings: [], missingInformation: [], priceSearchTerms: [],
        webComparison: { summary: "", sources: [], queries: [], status: "not_requested" },
      },
      quoteFiles: [], references: [], budgetContext: "No budget", history: [], useWeb: false,
    });
    expect(result.text).toBe("The offers differ in scope.");
    expect(generateContent).toHaveBeenCalledOnce();
    expect(generateContent.mock.calls[0][0].config.httpOptions.retryOptions).toEqual({
      attempts: 2, initialDelay: 1, maxDelay: 2, httpStatusCodes: [429],
    });
  });
});
