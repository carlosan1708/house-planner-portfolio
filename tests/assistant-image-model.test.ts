import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { imageFeatureEnabled, imageRouteOptions, readPageAnswer, renderPlanImage } from "../lib/assistant-image-model";

const mocks = vi.hoisted(() => ({ generate: vi.fn() }));
vi.mock("../lib/model-router", () => ({
  routeModel: () => ({ model: "architectural-image", maxReferences: 14 }),
  generateForTask: mocks.generate,
}));
vi.mock("../lib/firebase-admin", () => ({ projectBucket: null }));
vi.mock("../lib/qa-environment.mjs", () => ({ resolveFirebaseEnvironment: () => ({ isQa: process.env.HOUSE_PLANNER_ENVIRONMENT === "qa" }) }));

beforeEach(() => {
  mocks.generate.mockReset();
});

afterEach(() => vi.unstubAllEnvs());

describe("plan image references", () => {
  it("requires both explicit opt-ins and stays disabled in QA", () => {
    vi.stubEnv("HOUSE_PLANNER_ASSISTANT_IMAGES", undefined);
    vi.stubEnv("HOUSE_PLANNER_ENVIRONMENT", "production");
    vi.stubEnv("HOUSE_PLANNER_AI_ENABLED", undefined);
    expect(imageFeatureEnabled()).toBe(false);
    vi.stubEnv("HOUSE_PLANNER_ASSISTANT_IMAGES", "1");
    expect(imageFeatureEnabled()).toBe(false);
    vi.stubEnv("HOUSE_PLANNER_AI_ENABLED", "1");
    expect(imageFeatureEnabled()).toBe(true);
    vi.stubEnv("HOUSE_PLANNER_ENVIRONMENT", "qa");
    expect(imageFeatureEnabled()).toBe(false);
  });

  it.each([5, 16])("preserves page provenance when %i sheets contribute", async count => {
    const fixture = await sharp({ create: { width: 16, height: 16, channels: 3, background: "white" } }).jpeg().toBuffer();
    const evidence = Array.from({ length: count }, (_, index) => ({ page: index + 1, detail: `Drawing from page ${index + 1}` }));
    mocks.generate.mockResolvedValue({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/jpeg", data: fixture.toString("base64") } }] } }] });
    const render = vi.fn(async () => fixture);
    const result = await renderPlanImage("Render a facade", evidence, render);
    const request = mocks.generate.mock.calls[0][1];
    expect(request.contents[0].parts.filter((part: { inlineData?: object }) => part.inlineData)).toHaveLength(Math.min(count, 14));
    expect(request.contents[0].parts[0].text).toContain(`Drawing from page ${count}`);
    expect(result.references).toHaveLength(Math.min(count, 14));
  });

  it("retains architectural constraints on quick requests and validates manual page numbers", () => {
    expect(imageRouteOptions("Boceto rápido de la fachada")).toEqual({ quick: true, architectural: true });
    expect(readPageAnswer("1, 3, 3, 6", 6)).toEqual([1, 3, 6]);
    expect(readPageAnswer("2, 7", 6)).toEqual([]);
    expect(readPageAnswer("3-5", 6)).toEqual([]);
  });
});
