import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getSessionMember } from "@/lib/auth";
import { USAGE_COOKIE, USAGE_MAX_BYTES, UsageError, validateUsageBatch } from "@/lib/usage";
import { ingestUsage, usageCookieOptions, usageVisitor } from "@/lib/usage-store";

export const dynamic = "force-dynamic";
const privateHeaders = { "Cache-Control": "private, no-store, max-age=0" };

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const allowed = new Set([new URL(request.url).origin]);
  // Cloud Run preserves Host while standalone Next may expose an internal URL.
  // Forwarded Host is client-controlled and must never expand accepted origins.
  const host = request.headers.get("host")?.trim();
  const protocol = request.headers.get("x-forwarded-proto")?.trim().toLowerCase();
  if (host && !/[\\/\s@?#]/.test(host) && (protocol === "http" || protocol === "https")) {
    try { allowed.add(new URL(`${protocol}://${host}`).origin); } catch { /* Reject malformed proxy hosts. */ }
  }
  try { if (process.env.HOUSE_PLANNER_PUBLIC_URL) allowed.add(new URL(process.env.HOUSE_PLANNER_PUBLIC_URL).origin); } catch { /* Invalid configuration never trusts arbitrary origins. */ }
  return allowed.has(origin);
}

async function boundedBody(request: Request) {
  if (Number(request.headers.get("content-length")) > USAGE_MAX_BYTES) throw new UsageError("Analytics batch is too large", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new UsageError("Analytics batch required");
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > USAGE_MAX_BYTES) { await reader.cancel(); throw new UsageError("Analytics batch is too large", 413); }
    chunks.push(value);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown; } catch { throw new UsageError("Invalid analytics JSON"); }
}

export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) throw new UsageError("Same-origin analytics required", 403);
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new UsageError("JSON required", 415);
    if (/HeadlessChrome|Playwright/i.test(request.headers.get("user-agent") || "")) return NextResponse.json({ accepted: 0, excluded: true }, { status: 202, headers: privateHeaders });
    const body = await boundedBody(request);
    const member = await getSessionMember();
    const batch = validateUsageBatch(body, member);
    const cookieStore = await cookies();
    const visitor = usageVisitor(cookieStore.get(USAGE_COOKIE)?.value);
    const result = await ingestUsage(visitor, member, batch.events);
    const response = NextResponse.json(result, { status: 202, headers: privateHeaders });
    response.cookies.set(USAGE_COOKIE, visitor, usageCookieOptions);
    return response;
  } catch (error) {
    const status = error instanceof UsageError ? error.status : 503;
    if (status === 503) console.warn(JSON.stringify({ module: "analytics", code: "event_ingestion_unavailable" }));
    return NextResponse.json({ error: error instanceof UsageError ? error.message : "Analytics temporarily unavailable" }, { status, headers: { ...privateHeaders, ...(status === 429 ? { "Retry-After": "60" } : {}) } });
  }
}
