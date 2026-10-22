import { NextResponse } from "next/server";
import { GoogleAuth, OAuth2Client } from "google-auth-library";
import { firestore } from "@/lib/firebase-admin";
import { assertQaBillingTarget, parseQaBudgetMessage } from "@/lib/qa-budget-policy.mjs";

export const runtime = "nodejs";
const budgetVerifier = new OAuth2Client();

export async function POST(request: Request) {
  let target;
  try { target = assertQaBillingTarget(process.env); }
  catch { return NextResponse.json({ error: "Not found" }, { status: 404 }); }
  const token = request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const ticket = await budgetVerifier.verifyIdToken({ idToken: token, audience: target.audience });
    const claims = ticket.getPayload();
    if (claims?.email_verified !== true || claims.email !== target.email) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let event;
  try {
    if (Number(request.headers.get("content-length") || 0) > 20_000) throw new Error("Oversized message");
    const text = await request.text();
    if (text.length > 20_000) throw new Error("Oversized message");
    event = parseQaBudgetMessage(JSON.parse(text));
  } catch {
    // A signed, permanently malformed notification cannot become valid through retries.
    return NextResponse.json({ acknowledged: true, ignored: true }, { status: 202 });
  }
  if (!event) return NextResponse.json({ acknowledged: true, stale: true });
  try {
    const ref = firestore.collection("housePlannerQaControls").doc("budget");
    await ref.set({ budgetPeriod: event.period, reportedCostUsd: event.costAmount, reportedAt: new Date(), ...(event.cutoff ? { cutoffPeriod: event.period } : {}) }, { merge: true });
    if (event.cutoff) {
      // Fixed allowlist above: this credential has billing.projectManager only on QA.
      const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
      const client = await auth.getClient();
      await client.request({ url: `https://cloudbilling.googleapis.com/v1/projects/${target.projectId}/billingInfo`, method: "PUT", data: { billingAccountName: "" } });
    }
    return NextResponse.json({ acknowledged: true, cutoff: event.cutoff });
  } catch {
    // Pub/Sub retries failures; never acknowledge an unperformed cutoff.
    return NextResponse.json({ error: "QA budget notification failed" }, { status: 503 });
  }
}
