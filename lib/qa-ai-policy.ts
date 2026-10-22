import { ThinkingLevel, type GenerateContentParameters } from "@google/genai";
import { assertIsolatedQaEnvironment } from "./qa-environment.mjs";

const bounded = (value: string | undefined, fallback: number, maximum: number) => {
  const parsed = value ? Number(value) : fallback;
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) throw new Error("Invalid QA AI limit");
  return parsed;
};

export function qaAiPolicy(env: Record<string, string | undefined> = process.env) {
  const config = assertIsolatedQaEnvironment(env);
  return {
    enabled: !config.isEmulator && env.QA_AI_ENABLED === "1" && env.QA_BUDGET_STOPPED !== "1",
    callLimit: bounded(env.QA_AI_CALL_LIMIT, 4, 4),
    monthlyCallLimit: bounded(env.QA_AI_MONTHLY_CALL_LIMIT, 40, 40),
    inputTokenLimit: bounded(env.QA_AI_INPUT_TOKEN_LIMIT, 24_000, 24_000),
    inputByteLimit: bounded(env.QA_AI_INPUT_BYTE_LIMIT, 24_000, 24_000),
    outputTokenLimit: bounded(env.QA_AI_OUTPUT_TOKEN_LIMIT, 3072, 4096),
    model: "gemini-3.1-flash-lite",
    location: "global",
  };
}

function assertBasicQaMedia(value: unknown): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) { value.forEach(assertBasicQaMedia); return; }
  const item = value as Record<string, unknown>;
  for (const key of ["inlineData", "fileData"]) {
    if (item[key] === undefined) continue;
    const media = item[key] as { mimeType?: unknown } | undefined;
    if (typeof media?.mimeType !== "string" || !/^(?:image\/[a-z0-9.+-]+|application\/pdf)$/i.test(media.mimeType.trim())) throw new Error("qa_ai_basic_media_only");
  }
  Object.values(item).forEach(assertBasicQaMedia);
}

export function boundedQaAiRequest(request: GenerateContentParameters, env: Record<string, string | undefined> = process.env): GenerateContentParameters {
  const policy = qaAiPolicy(env);
  if (!policy.enabled) throw new Error("qa_ai_disabled");
  if (Buffer.byteLength(JSON.stringify({ contents: request.contents, config: request.config }), "utf8") > policy.inputByteLimit) throw new Error("qa_ai_input_limit");
  assertBasicQaMedia(request.contents);
  assertBasicQaMedia(request.config?.systemInstruction);
  if (request.config?.tools?.some((tool) => ("googleSearch" in tool && tool.googleSearch) || ("googleSearchRetrieval" in tool && tool.googleSearchRetrieval))) throw new Error("qa_ai_paid_search_disabled");
  return {
    ...request,
    model: policy.model,
    config: {
      ...request.config,
      candidateCount: 1,
      responseModalities: ["TEXT"],
      maxOutputTokens: Math.min(request.config?.maxOutputTokens || policy.outputTokenLimit, policy.outputTokenLimit),
      thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
      httpOptions: { ...request.config?.httpOptions, timeout: 90_000, retryOptions: { attempts: 1 } },
    },
  };
}
