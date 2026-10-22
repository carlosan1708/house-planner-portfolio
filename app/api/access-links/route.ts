import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { requireApproved } from "@/lib/auth";
import { commitActivity } from "@/lib/activity";
import { firestore } from "@/lib/firebase-admin";
import { normalizePermissions } from "@/lib/project";
import { ACCESS_LINK_DAYS, ACCESS_LINKS, accessLinkAuthentication, accessLinkDefaultSection, accessLinkLanguage, accessLinkOrigin, createAccessLinkToken, serializeAccessLink, validatedAccessLinkFolders } from "@/lib/access-links";
import { buildWorkspacePath } from "@/lib/workspace-navigation";

function label(value: unknown) {
  return typeof value === "string" ? value.trim().replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 80) : "";
}

export async function GET() {
  const actor = await requireApproved(["admin"]);
  if (!actor) return NextResponse.json({ error: "Administrator access required" }, { status: 403 });
  const snapshot = await firestore.collection(ACCESS_LINKS).where("projectId", "==", actor.projectId).get();
  return NextResponse.json({ links: snapshot.docs.map(serializeAccessLink).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))) });
}

export async function POST(request: Request) {
  const actor = await requireApproved(["admin"]);
  if (!actor) return NextResponse.json({ error: "Administrator access required" }, { status: 403 });
  const body = await request.json().catch(() => null) as { label?: unknown; permissions?: unknown; folderAccess?: unknown; authentication?: unknown; defaultLanguage?: unknown } | null;
  if (!body || !label(body.label)) return NextResponse.json({ error: "Pon un nombre al enlace de lectura." }, { status: 400 });
  if (body.authentication !== undefined && body.authentication !== "account" && body.authentication !== "public") return NextResponse.json({ error: "Selecciona un tipo de acceso válido." }, { status: 400 });
  if (body.defaultLanguage !== undefined && body.defaultLanguage !== "es" && body.defaultLanguage !== "en") return NextResponse.json({ error: "Selecciona un idioma válido." }, { status: 400 });
  const authentication = accessLinkAuthentication(body.authentication);
  const defaultLanguage = accessLinkLanguage(body.defaultLanguage);
  const permissions = normalizePermissions(body.permissions);
  if (!Object.values(permissions).some(Boolean)) return NextResponse.json({ error: "Selecciona al menos una sección para el enlace." }, { status: 400 });
  const folderAccess = await validatedAccessLinkFolders(body.folderAccess, actor.projectId);
  const { token, id } = createAccessLinkToken();
  const ref = firestore.collection(ACCESS_LINKS).doc(id);
  await commitActivity(actor, {
    category: "access", action: "access.link_created",
    target: { type: "access_link", id, label: label(body.label), section: "overview" },
    changes: [{ field: "status", before: null, after: "active", format: "status" }],
    visibility: { requiredTabs: ["overview"], adminOnly: true },
  }, (transaction) => transaction.set(ref, {
    projectId: actor.projectId, label: label(body.label), role: "viewer", status: "active", permissions, folderAccess, authentication, defaultLanguage,
    createdBy: actor.email, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
    expiresAt: new Date(Date.now() + ACCESS_LINK_DAYS * 24 * 60 * 60 * 1000), redemptionCount: 0,
  }));
  const url = new URL(buildWorkspacePath({ projectId: actor.projectId, section: accessLinkDefaultSection(permissions), budgetScope: null }), accessLinkOrigin(request));
  url.searchParams.set("accessLink", token);
  url.searchParams.set("lang", defaultLanguage);
  return NextResponse.json({ link: serializeAccessLink(await ref.get()), accessUrl: url.href }, { status: 201 });
}

export async function PATCH(request: Request) {
  const actor = await requireApproved(["admin"]);
  if (!actor) return NextResponse.json({ error: "Administrator access required" }, { status: 403 });
  const body = await request.json().catch(() => null) as { id?: unknown; action?: unknown; label?: unknown; permissions?: unknown; folderAccess?: unknown; authentication?: unknown; defaultLanguage?: unknown } | null;
  if (!body || typeof body.id !== "string" || !/^[a-f0-9]{64}$/.test(body.id) || (body.action !== "update" && body.action !== "revoke")) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const ref = firestore.collection(ACCESS_LINKS).doc(body.id);
  const snapshot = await ref.get();
  if (!snapshot.exists || snapshot.data()?.projectId !== actor.projectId) return NextResponse.json({ error: "El enlace de lectura no existe." }, { status: 404 });
  const data = snapshot.data()!;
  if (body.authentication !== undefined && body.authentication !== accessLinkAuthentication(data.authentication)) return NextResponse.json({ error: "El tipo de acceso no se puede cambiar. Crea un enlace nuevo." }, { status: 400 });
  if (body.defaultLanguage !== undefined && body.defaultLanguage !== "es" && body.defaultLanguage !== "en") return NextResponse.json({ error: "Selecciona un idioma válido." }, { status: 400 });
  if (body.action === "update" && body.label !== undefined && !label(body.label)) return NextResponse.json({ error: "Pon un nombre al enlace de lectura." }, { status: 400 });
  if (body.action === "update" && body.permissions !== undefined && !Object.values(normalizePermissions(body.permissions)).some(Boolean)) {
    return NextResponse.json({ error: "Selecciona al menos una sección para el enlace." }, { status: 400 });
  }
  const update = body.action === "revoke"
    ? { status: "revoked", revokedBy: actor.email, revokedAt: FieldValue.serverTimestamp() }
    : {
      ...(body.label !== undefined ? { label: label(body.label) } : {}),
      ...(body.permissions !== undefined ? { permissions: normalizePermissions(body.permissions) } : {}),
      ...(body.folderAccess !== undefined ? { folderAccess: await validatedAccessLinkFolders(body.folderAccess, actor.projectId) } : {}),
      ...(body.defaultLanguage !== undefined ? { defaultLanguage: body.defaultLanguage } : {}),
    };
  await commitActivity(actor, {
    category: "access", action: body.action === "revoke" ? "access.link_revoked" : "access.link_updated",
    target: { type: "access_link", id: body.id, label: String(data.label || "Read-only link"), section: "overview", exists: body.action !== "revoke" },
    visibility: { requiredTabs: ["overview"], adminOnly: true },
  }, (transaction) => transaction.set(ref, { ...update, updatedAt: FieldValue.serverTimestamp() }, { merge: true }));
  return NextResponse.json({ link: serializeAccessLink(await ref.get()) });
}
