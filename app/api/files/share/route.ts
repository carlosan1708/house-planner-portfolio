import { NextResponse } from "next/server";
import { Readable } from "node:stream";
import { getSessionMember } from "@/lib/auth";
import { assertFileShareCreator, createFileShare, downloadFileShare, FileShareError, parseFileShareInput } from "@/lib/file-sharing";

export const runtime = "nodejs";

const privateHeaders = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" };
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: privateHeaders });

function sameOrigin(request: Request) {
  const origin = request.headers.get("Origin");
  if (!origin) return false;
  const allowed = new Set([new URL(request.url).origin]);
  // Match the public request origin when standalone Next is behind Cloud Run's proxy.
  const host = request.headers.get("host")?.trim();
  const protocol = request.headers.get("x-forwarded-proto")?.trim().toLowerCase();
  if (host && !/[\\/\s@?#]/.test(host) && (protocol === "http" || protocol === "https")) {
    try { allowed.add(new URL(`${protocol}://${host}`).origin); } catch { /* Invalid hosts do not grant access. */ }
  }
  try {
    if (process.env.HOUSE_PLANNER_PUBLIC_URL) {
      const configured = new URL(process.env.HOUSE_PLANNER_PUBLIC_URL);
      if (configured.protocol === "http:" || configured.protocol === "https:") allowed.add(configured.origin);
    }
  } catch { /* Invalid configuration cannot expand accepted origins. */ }
  return allowed.has(origin);
}

function failure(error: unknown) {
  if (error instanceof FileShareError) return reply({ error: error.message }, error.status);
  return reply({ error: "File sharing is unavailable. Try again later." }, 503);
}

export async function POST(request: Request) {
  try {
    const actor = await getSessionMember();
    assertFileShareCreator(actor);
    if (!sameOrigin(request)) return reply({ error: "Invalid request origin" }, 403);
    const input = parseFileShareInput(await request.json().catch(() => null));
    return reply(await createFileShare(actor, input));
  } catch (error) { return failure(error); }
}

export async function GET(request: Request) {
  try {
    const result = await downloadFileShare(new URL(request.url).searchParams.get("token"));
    const stream = Readable.toWeb(result.stream) as ReadableStream<Uint8Array>;
    return new Response(stream, { headers: {
      ...privateHeaders, "Content-Type": "application/octet-stream", "Content-Disposition": result.disposition,
      "Content-Security-Policy": "sandbox; default-src 'none'", "Content-Length": result.contentLength,
    } });
  } catch (error) { return failure(error); }
}
