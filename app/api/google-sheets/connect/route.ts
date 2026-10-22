import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireTabAccess } from "@/lib/auth";
import { GOOGLE_STATE_COOKIE, googleOAuth, sealGoogleSecret } from "@/lib/google-sheets";

export async function GET() {
  const actor = await requireTabAccess("budget", ["admin", "editor"]);
  if (!actor) return NextResponse.json({ error: "Budget editing access required" }, { status: 403 });
  try {
    const client = googleOAuth();
    const state = randomBytes(32).toString("hex");
    (await cookies()).set(GOOGLE_STATE_COOKIE, sealGoogleSecret(JSON.stringify({ state, uid: actor.uid, projectId: actor.projectId, expires: Date.now() + 600_000 })), { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/api/google-sheets", maxAge: 600 });
    return NextResponse.redirect(client.generateAuthUrl({ access_type: "offline", prompt: "consent", scope: ["https://www.googleapis.com/auth/drive.file"], state }));
  } catch { return NextResponse.json({ error: "Google Sheets connection is not configured on this server" }, { status: 503 }); }
}
