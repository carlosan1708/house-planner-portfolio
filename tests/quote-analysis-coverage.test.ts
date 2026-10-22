import type { GenerateContentParameters } from "@google/genai";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ generate: vi.fn(), extract: vi.fn() }));
vi.mock("@/lib/gemini", () => ({
  assistantModel: () => "gemini-test",
  geminiConfigured: () => true,
  geminiClient: () => ({ models: { generateContent: mocks.generate } }),
}));
vi.mock("@/lib/document-index", () => ({ extractAssistantDocumentText: mocks.extract }));

import { analyzeQuote, normalizeQuoteAnalysis, type QuoteInputFile } from "@/lib/quote-analysis";
import { boundedQaAiRequest } from "@/lib/qa-ai-policy";

const file = (supplier: string, name: string, contentType = "application/pdf"): QuoteInputFile => ({
  supplier, name, contentType, objectKey: `projects/qa-primary/quotes/${name}`,
  ...(name.endsWith(".docx") ? { bytes: Buffer.from("synthetic DOCX") } : {}),
});
const quoteFiles = [file("Supplier A", "A.pdf"), file("Supplier A", "A-details.pdf"), file("Supplier B", "B.png", "image/png"), file("Supplier C", "C.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")];
const known = {
  supplier: "Supplier A", total: "CRC 100", scope: "Materials only", caveats: "Tax not stated",
};
const tile = { supplier: "Supplier A", detail: "10 tiles at CRC 10 each", evidence: "A.pdf p1" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("HOUSE_PLANNER_BUCKET", "house-planner-qa-test-files");
  mocks.extract.mockResolvedValue("Reference text without a verified quote total.");
});
afterEach(() => vi.unstubAllEnvs());

it("retains supported findings and shows every omitted supplier and row cell with its own submitted files", () => {
  const result = normalizeQuoteAnalysis({
    summary: "Supplier A covers materials.", recommendation: "Choose Supplier A; it is the cheapest.", missingInformation: ["Tax"],
    offerComparison: {
      suppliers: [known],
      rows: [{ item: "Tile", values: [tile], conclusion: "Only A's quantity is established." }],
    },
  }, { language: "en", quoteFiles });
  expect(result.offerComparison?.suppliers.map(offer => offer.supplier)).toEqual(["Supplier A", "Supplier B", "Supplier C"]);
  expect(result.offerComparison?.suppliers[0]).toEqual(known);
  expect(result.offerComparison?.suppliers[1]).toMatchObject({ total: "Not established by this analysis", scope: "Not established by this analysis" });
  expect(result.offerComparison?.suppliers[1].caveats).toContain("B.png");
  expect(result.offerComparison?.suppliers[1].caveats).not.toContain("C.docx");
  expect(result.offerComparison?.suppliers[2].caveats).toContain("C.docx");
  expect(result.offerComparison?.rows).toEqual([{ item: "Tile", conclusion: "Only A's quantity is established.", values: [
    tile,
    { supplier: "Supplier B", detail: "Not established by this analysis", evidence: expect.stringContaining("B.png") },
    { supplier: "Supplier C", detail: "Not established by this analysis", evidence: expect.stringContaining("C.docx") },
  ] }]);
  expect(result.missingInformation).toEqual(expect.arrayContaining(["Tax", expect.stringContaining("Supplier B:"), expect.stringContaining("Supplier C:")]));
  expect(result.recommendation).toContain("The comparison is incomplete");
  expect(result.recommendation).not.toContain("Choose Supplier A");
  expect(result.summary).toBe("Supplier A covers materials.");
});

it("preserves a complete model comparison and its source ownership while canonicalizing assigned label case", () => {
  const result = normalizeQuoteAnalysis({ recommendation: "Supplier B includes installation and fits the budget.", offerComparison: {
    suppliers: [{ ...known, supplier: " supplier a " }, { supplier: "Supplier B", total: "CRC 120", scope: "Installed", caveats: "Warranty not stated" }],
    rows: [{ item: "Installation", values: [
      { supplier: "SUPPLIER A", detail: "Not stated", evidence: "A-details.pdf p2" },
      { supplier: "Supplier B", detail: "Included", evidence: "B.png" },
    ], conclusion: "The scopes differ." }],
  } }, { language: "en", quoteFiles: quoteFiles.slice(0, 3) });
  expect(result.offerComparison?.suppliers).toEqual([known, { supplier: "Supplier B", total: "CRC 120", scope: "Installed", caveats: "Warranty not stated" }]);
  expect(result.offerComparison?.rows[0].values).toEqual([
    { supplier: "Supplier A", detail: "Not stated", evidence: "A-details.pdf p2" },
    { supplier: "Supplier B", detail: "Included", evidence: "B.png" },
  ]);
  expect(result.missingInformation).toEqual([]);
  expect(result.recommendation).toBe("Supplier B includes installation and fits the budget.");
});

it("does not attribute invented supplier labels or conflicting duplicate model totals to a submitted offer", () => {
  const result = normalizeQuoteAnalysis({ recommendation: "Choose Supplier A.", offerComparison: {
    suppliers: [known, { ...known, supplier: "SUPPLIER A", total: "CRC 999" }, { supplier: "Invented supplier", total: "CRC 500", scope: "Installed", caveats: "" }],
    rows: [{ item: "Total", values: [
      { supplier: "Supplier A", detail: "CRC 100", evidence: "A.pdf" },
      { supplier: "SUPPLIER A", detail: "CRC 999", evidence: "Unknown.pdf" },
      { supplier: "Invented supplier", detail: "CRC 500", evidence: "Invented.pdf" },
    ], conclusion: "Unverified output." }],
  } }, { language: "en", quoteFiles });
  expect(result.offerComparison?.suppliers.map(offer => offer.supplier)).toEqual(["Supplier A", "Supplier B", "Supplier C"]);
  expect(result.offerComparison?.suppliers[0].total).toBe("Not established by this analysis");
  expect(result.offerComparison?.rows[0].values[0].detail).toBe("Not established by this analysis");
  expect(result.offerComparison?.rows[0].values[0].evidence).toContain("A.pdf, A-details.pdf");
  expect(JSON.stringify(result.offerComparison)).not.toMatch(/CRC (?:999|500)|Invented\.pdf|Unknown\.pdf/);
  expect(result.recommendation).toContain("The comparison is incomplete");
  expect(result.recommendation).not.toContain("Choose Supplier A");
});

it("marks gaps in Spanish without manufacturing comparison rows or asserting the documents lack evidence", () => {
  const result = normalizeQuoteAnalysis({}, { language: "es", quoteFiles });
  expect(result.offerComparison?.rows).toEqual([]);
  expect(result.offerComparison?.suppliers[0]).toMatchObject({ supplier: "Supplier A", total: "No establecido por este análisis", scope: "No establecido por este análisis" });
  expect(result.offerComparison?.suppliers[0].caveats).toContain("El análisis no devolvió una comparación inequívoca");
  expect(result.offerComparison?.suppliers[0].caveats).toContain("A.pdf, A-details.pdf");
  expect(result.offerComparison?.suppliers[0].caveats).not.toMatch(/no contiene|no hay cotización|sin evidencia/);
  expect(result.recommendation).toContain("La comparación está incompleta; no es posible recomendar una oferta ganadora");
});

it("surfaces missing row details and source citations even when every supplier header was returned", () => {
  const result = normalizeQuoteAnalysis({ recommendation: "Preserved complete-offer recommendation.", offerComparison: {
    suppliers: [known, { supplier: "Supplier B", total: "CRC 120", scope: "Installed", caveats: "" }],
    rows: [{ item: "Tile", values: [{ ...tile, evidence: "" }], conclusion: "Quantity comparison." }],
  } }, { language: "en", quoteFiles: quoteFiles.slice(0, 3) });
  expect(result.offerComparison?.rows[0].values[0]).toMatchObject({ detail: tile.detail, evidence: expect.stringContaining("no source citation") });
  expect(result.offerComparison?.rows[0].values[1]).toMatchObject({ supplier: "Supplier B", detail: "Not established by this analysis", evidence: expect.stringContaining("B.png") });
  expect(result.missingInformation).toEqual([expect.stringContaining("Supplier A:"), expect.stringContaining("Supplier B:")]);
  expect(result.recommendation).toBe("Preserved complete-offer recommendation.");
});

it("uses an explicit current/historical offer manifest, excludes references and completes coverage with one bounded AI call", async () => {
  mocks.generate.mockResolvedValue({ text: JSON.stringify({ offerComparison: {
    suppliers: [known], rows: [{ item: "Tile", values: [tile], conclusion: "Only A's quantity is established." }],
  }, summary: "Supported summary.", recommendation: "Confirm installation.", priceSearchTerms: [] }) });
  const result = await analyzeQuote({ language: "en", quoteFiles,
    pastQuotes: [file("Historical supplier", "past.pdf")], references: [file("Reference only", "plans.pdf")],
    budgetContext: "Synthetic QA budget with CRC 100 objective.", useWeb: false,
  });
  expect(mocks.generate).toHaveBeenCalledOnce();
  const request = mocks.generate.mock.calls[0][0] as GenerateContentParameters;
  const contents = request.contents as Array<{ parts: Array<{ text?: string }> }>;
  const prompt = contents[0].parts[0].text!;
  const manifest = JSON.parse(prompt.split("SUBMITTED OFFER MANIFEST (server-assigned supplier labels and document ownership):\n")[1].split("\n")[0]);
  expect(manifest).toEqual([
    { supplier: "Supplier A", documents: [{ name: "A.pdf", source: "current" }, { name: "A-details.pdf", source: "current" }] },
    { supplier: "Supplier B", documents: [{ name: "B.png", source: "current" }] },
    { supplier: "Supplier C", documents: [{ name: "C.docx", source: "current" }] },
    { supplier: "Historical supplier", documents: [{ name: "past.pdf", source: "historical" }] },
  ]);
  expect(result.offerComparison?.suppliers.map(offer => offer.supplier)).toEqual(manifest.map((offer: { supplier: string }) => offer.supplier));
  expect(result.offerComparison?.rows[0].values).toHaveLength(4);
  expect(result.offerComparison?.rows[0].values[0]).toEqual(tile);
  expect(result.webComparison.status).toBe("not_requested");
  expect(mocks.extract).toHaveBeenCalledOnce();
  const bytes = Buffer.byteLength(JSON.stringify({ contents: request.contents, config: request.config }), "utf8");
  expect(bytes).toBeLessThan(24_000);
  expect(boundedQaAiRequest(request, { HOUSE_PLANNER_ENVIRONMENT: "qa", GOOGLE_CLOUD_PROJECT: "house-planner-qa-test", HOUSE_PLANNER_BUCKET: "house-planner-qa-test-files", QA_AI_ENABLED: "1" }).config).toMatchObject({ maxOutputTokens: 3072, httpOptions: { retryOptions: { attempts: 1 } } });
});

it("keeps the incomplete-offer caution after a successful market comparison without a winner-synthesis AI call", async () => {
  mocks.generate.mockResolvedValueOnce({ text: JSON.stringify({ recommendation: "Choose Supplier A.", priceSearchTerms: ["Tile CRC 10 per unit"], offerComparison: {
    suppliers: [known], rows: [{ item: "Tile", values: [tile], conclusion: "Known amount." }],
  } }) }).mockResolvedValueOnce({ text: "Supported public tile range.", candidates: [{ groundingMetadata: { groundingChunks: [{ web: { uri: "https://example.com/tile", title: "Tile" } }] } }] });
  const result = await analyzeQuote({ language: "en", quoteFiles, references: [], budgetContext: "Synthetic QA budget.", useWeb: true });
  expect(result.webComparison.status).toBe("ready");
  expect(result.recommendation).toContain("The comparison is incomplete");
  expect(result.recommendation).not.toContain("Choose Supplier A");
  expect(mocks.generate).toHaveBeenCalledTimes(2);
});
