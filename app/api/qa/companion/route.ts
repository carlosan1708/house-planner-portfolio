import { NextResponse } from "next/server";
import { requireApproved } from "@/lib/auth";
import { adminAuth, firestore } from "@/lib/firebase-admin";
import { MEMBERSHIPS, membershipId } from "@/lib/project";
import { assertQaWorkspace } from "@/lib/qa-reset";
import { validQaCompanionEmail } from "@/lib/qa-reset-policy";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const actor = await requireApproved(["admin"]);
  if (!actor) return NextResponse.json({ error: "QA access required" }, { status: 403 });
  try { await assertQaWorkspace(actor); }
  catch { return NextResponse.json({ error: "QA access required" }, { status: 403 }); }

  const body = await request.json().catch(() => null) as { action?: unknown; email?: unknown; password?: unknown } | null;
  if (!body || !validQaCompanionEmail(body.email))
    return NextResponse.json({ error: "Invalid QA companion" }, { status: 400 });

  const email = String(body.email).trim().toLowerCase();
  if (body.action === "drop_project_membership") {
    try {
      const user = await adminAuth.getUserByEmail(email);
      await firestore.collection(MEMBERSHIPS).doc(membershipId(actor.projectId, user.uid)).delete();
      return NextResponse.json({ uid: user.uid, email: user.email, membershipDeleted: true }, {
        headers: { "Cache-Control": "no-store" },
      });
    } catch {
      return NextResponse.json({ error: "QA companion membership reset failed" }, { status: 500 });
    }
  }
  if (typeof body?.password !== "string" || body.password.length < 8 || body.password.length > 128)
    return NextResponse.json({ error: "Invalid QA companion" }, { status: 400 });

  let user;
  let created = false;
  try {
    user = await adminAuth.getUserByEmail(email);
    user = await adminAuth.updateUser(user.uid, { password: body.password, disabled: false });
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
    if (code !== "auth/user-not-found") return NextResponse.json({ error: "QA companion provisioning failed" }, { status: 500 });
    user = await adminAuth.createUser({ email, password: body.password, displayName: "House Planner QA Viewer", disabled: false });
    created = true;
  }
  return NextResponse.json({ uid: user.uid, email: user.email, created }, {
    status: created ? 201 : 200,
    headers: { "Cache-Control": "no-store" },
  });
}
