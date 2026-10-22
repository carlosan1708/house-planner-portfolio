import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ qa: false, qaEnabled: true, create: vi.fn(), generate: vi.fn() }));
vi.mock("@google/genai", () => ({ GoogleGenAI: class {
  models = { generateContent: mock.generate, countTokens: vi.fn() };
  constructor(config: unknown) { mock.create(config); }
} }));
vi.mock("@/lib/qa-environment.mjs", () => ({ resolveFirebaseEnvironment: () => ({ isQa: mock.qa }) }));
vi.mock("@/lib/qa-ai-policy", () => ({ qaAiPolicy: () => ({ enabled: mock.qaEnabled, location: "global", model: "synthetic-model" }) }));
vi.mock("@/lib/qa-ai", () => ({ generateQaAiContent: vi.fn() }));

beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks();
  mock.qa = false; mock.qaEnabled = true;
  vi.stubEnv("GOOGLE_CLOUD_PROJECT", "example-house-planner");
  vi.stubEnv("HOUSE_PLANNER_AI_ENABLED", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("public snapshot live model opt-in", () => {
  it.each(["", "0", "true"])("denies model creation for opt-in value %s despite available cloud configuration", async (value) => {
    vi.stubEnv("HOUSE_PLANNER_AI_ENABLED", value);
    const { geminiClient, geminiConfigured } = await import("@/lib/gemini");
    expect(geminiConfigured()).toBe(false);
    expect(() => geminiClient()).toThrow("ai_disabled");
    expect(mock.create).not.toHaveBeenCalled();
  });
  it("also denies QA model calls without the public snapshot opt-in", async () => {
    mock.qa = true;
    const { geminiClient, geminiConfigured } = await import("@/lib/gemini");
    expect(geminiConfigured()).toBe(false);
    expect(() => geminiClient()).toThrow("ai_disabled");
    expect(mock.create).not.toHaveBeenCalled();
  });
  it("creates a client only after an explicit server opt-in", async () => {
    vi.stubEnv("HOUSE_PLANNER_AI_ENABLED", "1");
    const { geminiClient, geminiConfigured } = await import("@/lib/gemini");
    expect(geminiConfigured()).toBe(true);
    expect(geminiClient()).toHaveProperty("models");
    expect(mock.create).toHaveBeenCalledOnce();
    expect(mock.generate).not.toHaveBeenCalled();
  });
  it("preserves the independent QA authorization gate even with the server opt-in", async () => {
    mock.qa = true; mock.qaEnabled = false;
    vi.stubEnv("HOUSE_PLANNER_AI_ENABLED", "1");
    const { geminiClient, geminiConfigured } = await import("@/lib/gemini");
    expect(geminiConfigured()).toBe(false);
    expect(() => geminiClient()).toThrow("qa_ai_disabled");
    expect(mock.create).not.toHaveBeenCalled();
  });
});
