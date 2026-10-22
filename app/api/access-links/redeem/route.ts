import { NextResponse } from "next/server";
import { getSessionAccountIdentity } from "@/lib/auth";
import { ACCESS_LINKS, AccessLinkError, accessLinkDefaultSection, accessLinkLanguage, accessLinkTokenHash, redeemAccessLink, redeemPublicAccessLink } from "@/lib/access-links";
import { firestore } from "@/lib/firebase-admin";
import { ACTIVE_PROJECT_COOKIE, PUBLIC_ACCESS_LINK_COOKIE } from "@/lib/project";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { token?: unknown; requestedProjectId?: unknown } | null;
  if (!body || typeof body.token !== "string") return NextResponse.json({ error: "El enlace de lectura no es válido." }, { status: 400 });
  const requestedProjectId = typeof body.requestedProjectId === "string" ? body.requestedProjectId : "";
  try {
    const identity = await getSessionAccountIdentity();
    const publicAccess = !identity ? await redeemPublicAccessLink(body.token, requestedProjectId) : null;
    if (publicAccess) {
      const { member, maxAge } = publicAccess;
      const response = NextResponse.json({ ok: true, projectId: member.projectId, publicAccess: true, defaultLanguage: member.linkDefaultLanguage, defaultSection: publicAccess.defaultSection });
      response.cookies.set(PUBLIC_ACCESS_LINK_COOKIE, body.token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge });
      response.cookies.set(ACTIVE_PROJECT_COOKIE, member.projectId, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge });
      return response;
    }
    if (!identity) return NextResponse.json({ error: "Inicia sesión para aceptar el enlace de lectura." }, { status: 401 });
    const projectId = await redeemAccessLink(identity, body.token, requestedProjectId);
    const policy = await firestore.collection(ACCESS_LINKS).doc(accessLinkTokenHash(body.token)).get();
    const response = NextResponse.json({ ok: true, projectId, publicAccess: false, defaultLanguage: accessLinkLanguage(policy.data()?.defaultLanguage), defaultSection: accessLinkDefaultSection(policy.data()?.permissions) });
    response.cookies.set(ACTIVE_PROJECT_COOKIE, projectId, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 30 * 24 * 60 * 60 });
    response.cookies.set(PUBLIC_ACCESS_LINK_COOKIE, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 0 });
    return response;
  } catch (reason) {
    if (reason instanceof AccessLinkError) return NextResponse.json({ error: reason.message }, { status: reason.status });
    return NextResponse.json({ error: "No se pudo aceptar el enlace de lectura. Inténtalo de nuevo." }, { status: 503 });
  }
}
