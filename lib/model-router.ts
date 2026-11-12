import type { GenerateContentParameters } from "@google/genai";
import { assistantModel, geminiClient } from "./gemini";

export type ModelTask = "assistant" | "receipt" | "documentRanking" | "quoteAnalysis" | "quoteWeb" | "planAnalysis" | "planImage";
export const PRO_IMAGE = "gemini-3-pro-image";
export const QUICK_IMAGE = "gemini-nano-banana-2.1";
type Route = { model: string; reason: string; maxReferences?: number; fallback?: string };

export function routeModel(task: ModelTask, options: { baseline?: string; quick?: boolean; architectural?: boolean } = {}): Route {
  const qa = process.env.HOUSE_PLANNER_ENVIRONMENT?.trim() === "qa";
  if (task === "planImage") {
    if (qa) throw new Error("image_generation_unavailable");
    const quick = options.quick && !options.architectural;
    return { model: quick ? QUICK_IMAGE : PRO_IMAGE, reason: quick ? "requested_concept" : "plan_fidelity", maxReferences: 14 };
  }
  const baseline = options.baseline || assistantModel();
  // The shared adapter validates the environment and enforces the QA model.
  if (qa) return { model: baseline, reason: "qa_policy" };
  const candidate = task === "receipt" ? process.env.GEMINI_RECEIPT_MODEL?.trim() : undefined;
  return candidate && candidate !== baseline
    ? { model: candidate, reason: "approved_visual_extraction", fallback: baseline }
    : { model: baseline, reason: "workflow_baseline" };
}

function retryable(error: unknown) {
  return error instanceof Error && "status" in error && [429, 502, 503, 504].includes(Number(error.status));
}

export async function generateForTask(task: ModelTask, request: Omit<GenerateContentParameters, "model">, route = routeModel(task)) {
  async function attempt(model: string, reason: string) {
    const started = Date.now();
    try {
      const response = await geminiClient().models.generateContent({ ...request, model });
      const usage = response.usageMetadata;
      console.info("model_route", { task, model: response.modelVersion || model, reason, result: "ok", ms: Date.now() - started, tokens: usage?.totalTokenCount });
      return response;
    } catch (error) {
      console.warn("model_route", { task, model, reason, result: "failed", ms: Date.now() - started });
      throw error;
    }
  }
  try {
    return await attempt(route.model, route.reason);
  } catch (error) {
    if (!route.fallback || request.config?.abortSignal?.aborted || !retryable(error)) throw error;
    return attempt(route.fallback, "compatible_fallback");
  }
}
