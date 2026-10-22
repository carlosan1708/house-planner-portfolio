import { GoogleGenAI, type Tool } from "@google/genai";
import { resolveFirebaseEnvironment } from "./qa-environment.mjs";
import { qaAiPolicy } from "./qa-ai-policy";
import { generateQaAiContent } from "./qa-ai";

let cachedClient: GoogleGenAI | null = null;

export function geminiConfigured() {
  if (process.env.HOUSE_PLANNER_AI_ENABLED !== "1") return false;
  if (resolveFirebaseEnvironment().isQa) return qaAiPolicy().enabled;
  return Boolean((process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT)?.trim());
}

export function geminiClient() {
  if (process.env.HOUSE_PLANNER_AI_ENABLED !== "1") throw new Error("ai_disabled");
  const qa = resolveFirebaseEnvironment().isQa;
  if (qa && !qaAiPolicy().enabled) throw new Error("qa_ai_disabled");
  const project = (process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT)?.trim();
  if (!project) throw new Error("gemini_not_configured");
  if (!cachedClient) {
    const client = new GoogleGenAI({
    vertexai: true,
    project,
    location: qa ? qaAiPolicy().location : process.env.GOOGLE_CLOUD_LOCATION?.trim() || "global",
    apiVersion: "v1",
    });
    if (qa) {
      const generate = client.models.generateContent.bind(client.models);
      client.models.generateContent = (request) => generateQaAiContent(request, generate, async (boundedRequest) => {
        const counted = await client.models.countTokens({
          model: boundedRequest.model, contents: boundedRequest.contents || [],
          config: { systemInstruction: boundedRequest.config?.systemInstruction, tools: boundedRequest.config?.tools as Tool[] | undefined, httpOptions: { timeout: 30_000, retryOptions: { attempts: 1 } } },
        });
        return counted.totalTokens;
      });
    }
    cachedClient = client;
  }
  return cachedClient;
}

export const assistantModel = () => resolveFirebaseEnvironment().isQa ? qaAiPolicy().model : process.env.GEMINI_MODEL?.trim() || "gemini-3.1-pro-preview";
