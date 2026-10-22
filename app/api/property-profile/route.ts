import { NextResponse } from "next/server";
import { requireTabAccess } from "@/lib/auth";
import { firestore } from "@/lib/firebase-admin";
import { PROPERTY_PROFILES } from "@/lib/project";

type Measurement = { id?: unknown; labelEn?: unknown; labelEs?: unknown; value?: unknown; emphasis?: unknown };

const text = (value: unknown, limit: number) => typeof value === "string" ? value.trim().slice(0, limit) : "";

export async function GET() {
  const actor = await requireTabAccess("overview");
  if (!actor) return NextResponse.json({ error: "Overview access required" }, { status: 403 });
  const snapshot = await firestore.collection(PROPERTY_PROFILES).doc(actor.projectId).get();
  if (!snapshot.exists) return NextResponse.json({ profile: null });
  const data = snapshot.data() || {};
  const measurements = Array.isArray(data.measurements) ? data.measurements as Measurement[] : [];
  return NextResponse.json({
    profile: {
      revisionLabelEn: text(data.revisionLabelEn, 100),
      revisionLabelEs: text(data.revisionLabelEs, 100),
      measurements: measurements.slice(0, 30).map((item, index) => ({
        id: text(item.id, 80) || `measurement-${index}`,
        labelEn: text(item.labelEn, 240),
        labelEs: text(item.labelEs, 240),
        value: text(item.value, 120),
        emphasis: item.emphasis === true,
      })).filter((item) => item.labelEn || item.labelEs),
    },
  });
}
