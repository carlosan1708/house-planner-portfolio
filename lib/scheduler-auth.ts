import "server-only";
import { OAuth2Client } from "google-auth-library";

const verifier = new OAuth2Client();

export async function verifySchedulerRequest(request: Request) {
  const authorization = request.headers.get("authorization") || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  const audience = (process.env.HOUSE_PLANNER_PUBLIC_URL || "").replace(/\/$/, "");
  const expectedEmail = (process.env.HOUSE_PLANNER_SCHEDULER_SERVICE_ACCOUNT || "").toLowerCase();
  if (!token || !audience || !expectedEmail) return false;
  try {
    const ticket = await verifier.verifyIdToken({ idToken: token, audience });
    const payload = ticket.getPayload();
    return payload?.email_verified === true && String(payload.email || "").toLowerCase() === expectedEmail;
  } catch {
    return false;
  }
}
