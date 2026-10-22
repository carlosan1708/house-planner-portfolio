import { NextResponse } from "next/server";
import { requireTabAccess } from "@/lib/auth";
import { semanticDocumentSearch } from "@/lib/document-search";
import { DocumentSearchFailure, documentSearchActor, documentSearchQuery, type DocumentSearchCode } from "@/lib/document-search-policy";

export const runtime = "nodejs";
const messages: Record<DocumentSearchCode, string> = {
  semantic_unavailable: "Semantic search is temporarily unavailable. Try searching by name or description.",
  search_limit: "Semantic search limit reached. Try again later.",
  semantic_scope_limit: "This project exceeds the semantic search size limit. Search by name or description.",
  invalid_query: "Provide a search query of up to 400 characters and a supported language.",
  denied: "Documents account access required.",
};
const reply = (body: unknown, status = 200, retryAfter?: number) => NextResponse.json(body, {
  status, headers: { "Cache-Control": "private, no-store", ...(retryAfter ? { "Retry-After": String(retryAfter) } : {}) },
});

async function boundedInput(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new DocumentSearchFailure("invalid_query", 400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 4096) {
        await reader.cancel();
        throw new DocumentSearchFailure("invalid_query", 400);
      }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new DocumentSearchFailure("invalid_query", 400);
  } finally {
    reader.releaseLock();
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireTabAccess("documents");
    if (!documentSearchActor(actor)) throw new DocumentSearchFailure("denied", 403);
    const input = documentSearchQuery(await boundedInput(request));
    return reply(await semanticDocumentSearch(actor, input, request.signal));
  } catch (error) {
    const failure = error instanceof DocumentSearchFailure ? error : new DocumentSearchFailure("semantic_unavailable", 503);
    return reply({ code: failure.code, error: messages[failure.code] }, failure.status, failure.retryAfter);
  }
}
