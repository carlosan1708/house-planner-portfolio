import { describe, expect, it } from "vitest";
import { boundedQaAiRequest, qaAiPolicy } from "@/lib/qa-ai-policy";

const env = { HOUSE_PLANNER_ENVIRONMENT: "qa", GOOGLE_CLOUD_PROJECT: "house-planner-qa-test", HOUSE_PLANNER_BUCKET: "house-planner-qa-test-files" };
describe("basic QA AI spending limits", () => {
  it("is disabled without explicit permission and cannot run against production", () => {
    expect(qaAiPolicy(env).enabled).toBe(false);
    expect(() => boundedQaAiRequest({ model: "expensive", contents: "hello" }, env)).toThrow("qa_ai_disabled");
    expect(() => qaAiPolicy({ ...env, GOOGLE_CLOUD_PROJECT: "example-house-planner" })).toThrow("production");
    expect(qaAiPolicy({ ...env, QA_AI_ENABLED: "1", QA_BUDGET_STOPPED: "1" }).enabled).toBe(false);
  });
  it("forces a supported inexpensive global model, one text candidate and bounded minimal thinking without retries", () => {
    const request = boundedQaAiRequest({ model: "gemini-3.1-pro-preview", contents: "hello", config: { candidateCount: 8, responseModalities: ["AUDIO"], maxOutputTokens: 30_000, thinkingConfig: { thinkingBudget: 10_000 } } }, { ...env, QA_AI_ENABLED: "1" });
    expect(request.model).toBe("gemini-3.1-flash-lite");
    expect(qaAiPolicy(env).location).toBe("global");
    expect(request.config).toMatchObject({ candidateCount: 1, responseModalities: ["TEXT"], maxOutputTokens: 3072, thinkingConfig: { thinkingLevel: "MINIMAL" }, httpOptions: { timeout: 90_000, retryOptions: { attempts: 1 } } });
    expect(request.config?.thinkingConfig).not.toHaveProperty("thinkingBudget");
  });
  it("excludes audio and video from basic QA while allowing image and PDF inputs", () => {
    const enabled = { ...env, QA_AI_ENABLED: "1" };
    for (const mimeType of ["audio/mpeg", "video/mp4"]) {
      expect(() => boundedQaAiRequest({ model: "unused", contents: [{ role: "user", parts: [{ inlineData: { mimeType, data: "cWE=" } }] }] }, enabled)).toThrow("basic_media_only");
      expect(() => boundedQaAiRequest({ model: "unused", contents: [{ role: "user", parts: [{ fileData: { mimeType, fileUri: "gs://house-planner-qa-test-files/fixture" } }] }] }, enabled)).toThrow("basic_media_only");
    }
    expect(() => boundedQaAiRequest({ model: "unused", contents: [{ role: "user", parts: [{ fileData: { fileUri: "gs://house-planner-qa-test-files/unknown-media" } }] }] }, enabled)).toThrow("basic_media_only");
    expect(boundedQaAiRequest({ model: "unused", contents: [{ role: "user", parts: [{ inlineData: { mimeType: "image/png", data: "cWE=" } }, { inlineData: { mimeType: "application/pdf", data: "cWE=" } }] }] }, enabled).model).toBe("gemini-3.1-flash-lite");
  });
  it("denies unbounded inputs, paid grounding and raised call quotas", () => {
    const enabled = { ...env, QA_AI_ENABLED: "1" };
    expect(() => boundedQaAiRequest({ model: "unused", contents: "x".repeat(24_001) }, enabled)).toThrow("input_limit");
    expect(() => boundedQaAiRequest({ model: "unused", contents: "hello", config: { tools: [{ googleSearch: {} }] } }, enabled)).toThrow("paid_search");
    expect(() => qaAiPolicy({ ...enabled, QA_AI_CALL_LIMIT: "5" })).toThrow("Invalid");
    expect(() => qaAiPolicy({ ...enabled, QA_AI_MONTHLY_CALL_LIMIT: "41" })).toThrow("Invalid");
  });
});
