import { NextResponse } from "next/server";
import { requireTabAccess } from "@/lib/auth";
import { googleConfigured, googleConnectionRef } from "@/lib/google-sheets";
import { googleBudgetRef, googleSyncMessage, syncGoogleBudget } from "@/lib/google-budget";

export async function GET() {
  const actor = await requireTabAccess("budget", ["admin", "editor"]);
  if (!actor) return NextResponse.json({ error: "Budget editing access required" }, { status: 403 });
  const configured = googleConfigured();
  const link = configured ? (await googleBudgetRef(actor.projectId).get()).data() : null;
  const connection = configured && link?.authMode !== "service_account" ? await googleConnectionRef(actor.projectId, String(link?.ownerUid || actor.uid)).get() : null;
  return NextResponse.json({ configured, managed: link?.authMode === "service_account", connected: link?.authMode === "service_account" ? Boolean(process.env.HOUSE_PLANNER_GOOGLE_SERVICE_ACCOUNT && link?.fileId) : Boolean(connection?.data()?.token), canCreate: actor.role === "admin", url: link?.fileId ? `https://docs.google.com/spreadsheets/d/${link.fileId}/edit` : "", folderUrl: link?.folderId ? `https://drive.google.com/drive/folders/${link.folderId}` : "", error: link?.error || "", syncedAt: link?.syncedAt || null });
}

export async function DELETE() {
  const actor = await requireTabAccess("budget", ["admin", "editor"]);
  if (!actor) return NextResponse.json({ error: "Budget editing access required" }, { status: 403 });
  const link = (await googleBudgetRef(actor.projectId).get()).data();
  if (link?.fileId && link.ownerUid === actor.uid) return NextResponse.json({ error: "Esta conexión mantiene la hoja consolidada del proyecto." }, { status: 409 });
  await googleConnectionRef(actor.projectId, actor.uid).delete();
  return NextResponse.json({ disconnected: true });
}

export async function POST(request: Request) {
  const actor = await requireTabAccess("budget", ["admin", "editor"]);
  if (!actor) return NextResponse.json({ error: "Budget editing access required" }, { status: 403 });
  if (!googleConfigured()) return NextResponse.json({ error: "Google Sheets connection is not configured on this server" }, { status: 503 });
  let action: string;
  try { action = (await request.json()).action; } catch { return NextResponse.json({ error: "Invalid request" }, { status: 400 }); }
  if (!["ensure", "sync", "use-google"].includes(action)) return NextResponse.json({ error: "Actualiza la página: ahora se usa una sola hoja consolidada por proyecto." }, { status: 400 });
  if (action !== "sync" && actor.role !== "admin") return NextResponse.json({ error: "Esta acción requiere al propietario." }, { status: 403 });
  try {
    const link = await syncGoogleBudget(actor.projectId, action === "ensure" ? actor.uid : undefined, action === "use-google");
    if (!link) return NextResponse.json({ error: "Activa primero la hoja consolidada." }, { status: 409 });
    return NextResponse.json({ url: `https://docs.google.com/spreadsheets/d/${link.fileId}/edit`, folderUrl: `https://drive.google.com/drive/folders/${link.folderId}` });
  } catch (error) { return NextResponse.json({ error: googleSyncMessage(error) }, { status: 409 }); }
}
