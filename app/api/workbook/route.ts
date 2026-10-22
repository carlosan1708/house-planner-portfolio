import { NextResponse } from "next/server";
import { requireTabAccess } from "@/lib/auth";
import { firestore } from "@/lib/firebase-admin";
import { OVERRIDES } from "@/lib/project";

export async function GET() {
  const actor = await requireTabAccess("budget");
  if (!actor) return NextResponse.json({ error: "Workbook access required" }, { status: 403 });
  const snapshot = await firestore.collection(OVERRIDES).where("projectId", "==", actor.projectId).get();
  return NextResponse.json({ overrides: snapshot.docs.map((doc) => {
    const data = doc.data();
    return { sheetName: data.sheetName, rowIndex: data.rowIndex, columnIndex: data.columnIndex, value: data.value ?? null };
  }) });
}

export async function POST() {
  const actor = await requireTabAccess("budget", ["admin", "editor"]);
  if (!actor) return NextResponse.json({ error: "Workbook editor access required" }, { status: 403 });
  return NextResponse.json({ error: "Legacy workbook overrides are read-only. Use versioned workbook publishing." }, { status: 410 });
}
