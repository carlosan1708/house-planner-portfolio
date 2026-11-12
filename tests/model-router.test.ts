import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateForTask, PRO_IMAGE, QUICK_IMAGE, routeModel } from "../lib/model-router";

const mocks = vi.hoisted(() => ({ generate: vi.fn(), primary: vi.fn() }));
vi.mock("../lib/gemini", () => ({
  assistantModel: mocks.primary,
  geminiClient: () => ({ models: { generateContent: mocks.generate } }),
}));

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  vi.stubEnv("HOUSE_PLANNER_ENVIRONMENT", "production");
  mocks.primary.mockReturnValue("approved-primary");
  mocks.generate.mockReset();
});

describe("assistant model routing", () => {
  it("uses the architectural image route when speed conflicts with architectural fidelity", () => {
    expect(routeModel("planImage", { quick: true, architectural: true })).toMatchObject({ model: PRO_IMAGE, maxReferences: 14 });
    expect(routeModel("planImage", { quick: true })).toMatchObject({ model: QUICK_IMAGE, maxReferences: 14 });
  });

  it("keeps workflow defaults and isolates the configured receipt candidate", () => {
    vi.stubEnv("GEMINI_RECEIPT_MODEL", "approved-vision");
    expect(routeModel("assistant").model).toBe("approved-primary");
    expect(routeModel("quoteAnalysis").model).toBe("approved-primary");
    expect(routeModel("documentRanking", { baseline: "document-ranker" }).model).toBe("document-ranker");
    expect(routeModel("receipt")).toMatchObject({ model: "approved-vision", fallback: "approved-primary" });
  });

  it("uses the receipt baseline for a transient failure and does not reroute rejected input", async () => {
    vi.stubEnv("GEMINI_RECEIPT_MODEL", "approved-vision");
    mocks.generate.mockRejectedValueOnce(Object.assign(new Error("transient"), { status: 503 })).mockResolvedValueOnce({ text: "found" });
    await expect(generateForTask("receipt", { contents: "extract" })).resolves.toMatchObject({ text: "found" });
    expect(mocks.generate.mock.calls.map(([request]) => request.model)).toEqual(["approved-vision", "approved-primary"]);
    mocks.generate.mockClear().mockRejectedValueOnce(Object.assign(new Error("bad request"), { status: 400 }));
    await expect(generateForTask("receipt", { contents: "extract" })).rejects.toThrow("bad request");
    expect(mocks.generate).toHaveBeenCalledTimes(1);
  });

  it("honors QA model policy and blocks image routing there", () => {
    vi.stubEnv("HOUSE_PLANNER_ENVIRONMENT", "qa");
    mocks.primary.mockReturnValue("qa-text-model");
    vi.stubEnv("GEMINI_RECEIPT_MODEL", "production-vision");
    expect(routeModel("receipt")).toEqual({ model: "qa-text-model", reason: "qa_policy" });
    expect(() => routeModel("planImage")).toThrow("image_generation_unavailable");
  });
});
