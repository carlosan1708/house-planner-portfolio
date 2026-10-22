import { NextResponse } from "next/server";
import { requireTabAccess } from "@/lib/auth";
import { editorPayload, generatedEditorPayload } from "@/lib/workbook-store";
import type { WorkbookScope } from "@/lib/workbook";

export async function GET(request: Request) {
  const actor = await requireTabAccess("budget");
  if (!actor) return NextResponse.json({ error: "Workbook access required" }, { status: 403 });
  const parameters = new URL(request.url).searchParams;
  const key = parameters.get("group"); const label = parameters.get("label"); const all = parameters.get("all") === "true";
  const scope = key && ["chapter", "type", "subcategory"].includes(key) && (all || label) ? { key, label: label || undefined, all } as WorkbookScope : null;
  try { return NextResponse.json(scope ? await generatedEditorPayload(actor.projectId, scope) : await editorPayload(actor.projectId)); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Workbook unavailable" }, { status: 503 }); }
}
