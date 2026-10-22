import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireTabAccess } from "@/lib/auth";
import { GOOGLE_STATE_COOKIE, googleConnectionRef, googleOAuth, openGoogleSecret, sealGoogleSecret } from "@/lib/google-sheets";
import { syncGoogleBudget } from "@/lib/google-budget";

export async function GET(request: Request) {
  const actor = await requireTabAccess("budget", ["admin", "editor"]);
  const jar = await cookies();
  const stateCookie = jar.get(GOOGLE_STATE_COOKIE)?.value;
  jar.set(GOOGLE_STATE_COOKIE, "", { path: "/api/google-sheets", maxAge: 0 });
  try {
    if (!actor || !stateCookie) throw new Error("Invalid session");
    const state = JSON.parse(openGoogleSecret(stateCookie));
    const url = new URL(request.url);
    if (state.uid !== actor.uid || state.projectId !== actor.projectId || state.expires < Date.now() || state.state !== url.searchParams.get("state") || !url.searchParams.get("code")) throw new Error("Invalid state");
    const { tokens } = await googleOAuth().getToken(url.searchParams.get("code")!);
    if (!tokens.refresh_token) throw new Error("Missing offline authorization");
    await googleConnectionRef(actor.projectId, actor.uid).set({ projectId: actor.projectId, uid: actor.uid, token: sealGoogleSecret(tokens.refresh_token), connectedAt: new Date().toISOString() });
    if (actor.role === "admin") await syncGoogleBudget(actor.projectId, actor.uid).catch(() => undefined);
    return NextResponse.redirect(new URL("/?section=budget&google=connected", process.env.HOUSE_PLANNER_PUBLIC_URL));
  } catch { return NextResponse.json({ error: "Google connection was not completed. Return to House Planner and connect again." }, { status: 400 }); }
}
