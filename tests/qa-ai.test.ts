import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ records: new Map<string, Record<string, unknown>>(), queue: Promise.resolve() }));
vi.mock("@/lib/firebase-admin", () => ({ firestore: {
  collection: (collection: string) => ({ doc: (id: string) => ({ path: `${collection}/${id}` }) }),
  runTransaction: (callback: (transaction: unknown) => Promise<unknown>) => {
    const operation = state.queue.then(async () => {
      const writes = new Map<string, Record<string, unknown>>();
      const result = await callback({
        getAll: async (...refs: { path: string }[]) => refs.map((ref) => ({ data: () => state.records.get(ref.path) })),
        set: (ref: { path: string }, data: Record<string, unknown>) => writes.set(ref.path, { ...state.records.get(ref.path), ...data }),
      });
      for (const [key, data] of writes) state.records.set(key, data);
      return result;
    });
    state.queue = operation.then(() => undefined, () => undefined);
    return operation;
  },
} }));

import { generateQaAiContent } from "@/lib/qa-ai";

const projectPath = "housePlannerProjects/qa-primary";
const monthPath = () => `housePlannerQaAiUsage/${new Date().toISOString().slice(0, 7)}`;
const request = { model: "unused", contents: "basic synthetic request" };
const countTokens = async () => 20;
beforeEach(() => {
  state.records.clear();
  state.queue = Promise.resolve();
  vi.stubEnv("HOUSE_PLANNER_ENVIRONMENT", "qa");
  vi.stubEnv("GOOGLE_CLOUD_PROJECT", "house-planner-qa-test");
  vi.stubEnv("HOUSE_PLANNER_BUCKET", "house-planner-qa-test-files");
  for (const key of ["FIREBASE_AUTH_EMULATOR_HOST", "FIRESTORE_EMULATOR_HOST", "FIREBASE_STORAGE_EMULATOR_HOST", "STORAGE_EMULATOR_HOST", "GOOGLE_CLOUD_QUOTA_PROJECT", "HOUSE_PLANNER_GOOGLE_SERVICE_ACCOUNT", "HOUSE_PLANNER_GMAIL_REFRESH_TOKEN", "HOUSE_PLANNER_GOOGLE_CLIENT_SECRET", "HOUSE_PLANNER_GOOGLE_TOKEN_KEY", "NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST"]) vi.stubEnv(key, "");
  vi.stubEnv("GCLOUD_PROJECT", "house-planner-qa-test");
  vi.stubEnv("GCP_PROJECT", "house-planner-qa-test");
  vi.stubEnv("NEXT_PUBLIC_HOUSE_PLANNER_ENVIRONMENT", "qa");
  vi.stubEnv("NEXT_PUBLIC_FIREBASE_PROJECT_ID", "house-planner-qa-test");
  vi.stubEnv("NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET", "house-planner-qa-test-files");
  vi.stubEnv("QA_AI_ENABLED", "1");
  vi.stubEnv("QA_BUDGET_STOPPED", "0");
  vi.stubEnv("QA_AI_CALL_LIMIT", "4");
  vi.stubEnv("QA_AI_MONTHLY_CALL_LIMIT", "40");
  vi.stubEnv("QA_AI_INPUT_TOKEN_LIMIT", "24000");
  vi.stubEnv("QA_AI_INPUT_BYTE_LIMIT", "24000");
  vi.stubEnv("QA_AI_OUTPUT_TOKEN_LIMIT", "3072");
  state.records.set(projectPath, { qaRegressionRunId: "requested-regression", qaRegressionAiEnabled: true, qaRegressionLeaseUntil: { toMillis: () => Date.now() + 60_000 } });
});
afterEach(() => vi.unstubAllEnvs());

describe("durable QA AI reservations", () => {
  it("atomically permits only four concurrent calls per requested regression", async () => {
    const generate = vi.fn(async () => ({ text: "synthetic" }));
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => generateQaAiContent(request, generate as never, countTokens)));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(4);
    expect(generate).toHaveBeenCalledTimes(4);
    expect(state.records.get(monthPath())?.calls).toBe(4);
  });
  it("counts failed calls and denies a renewed run at the monthly limit", async () => {
    const generate = vi.fn(async () => { throw new Error("upstream failure"); });
    await expect(generateQaAiContent(request, generate as never, countTokens)).rejects.toThrow("upstream");
    expect(state.records.get(projectPath)?.qaAiCalls).toBe(1);
    expect(state.records.get(monthPath())?.calls).toBe(1);
    state.records.set(projectPath, { ...state.records.get(projectPath), qaRegressionRunId: "next-requested-regression" });
    state.records.set(monthPath(), { calls: 40 });
    await expect(generateQaAiContent(request, generate as never, countTokens)).rejects.toThrow("monthly_call_limit");
    expect(generate).toHaveBeenCalledTimes(1);
  });
  it("requires explicit AI approval in the active lease and respects budget cutoff", async () => {
    const generate = vi.fn();
    state.records.set(projectPath, { ...state.records.get(projectPath), qaRegressionAiEnabled: false });
    await expect(generateQaAiContent(request, generate, countTokens)).rejects.toThrow("requested_run_required");
    state.records.set(projectPath, { ...state.records.get(projectPath), qaRegressionAiEnabled: true });
    state.records.set("housePlannerQaControls/budget", { cutoffPeriod: new Date().toISOString().slice(0, 7) });
    await expect(generateQaAiContent(request, generate, countTokens)).rejects.toThrow("budget_cutoff");
    expect(generate).not.toHaveBeenCalled();
    expect(state.records.get(monthPath())).toBeUndefined();
  });
  it("checks actual multimodal input tokens before generating", async () => {
    const generate = vi.fn();
    await expect(generateQaAiContent(request, generate, async () => 24_001)).rejects.toThrow("input_token_limit");
    await expect(generateQaAiContent(request, generate, async () => undefined)).rejects.toThrow("input_token_limit");
    expect(generate).not.toHaveBeenCalled();
  });
});
