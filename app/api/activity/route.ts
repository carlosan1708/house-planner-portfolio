import { NextResponse } from "next/server";
import { requireApproved } from "@/lib/auth";
import { ACTIVITY_CATEGORIES } from "@/lib/activity-types";
import { activityEvents, activityMatches, canViewActivity, serializeActivity } from "@/lib/activity";
import { loadProjectAuthorDisplay } from "@/lib/project-authors";

const parseDate = (value: string | null, end = false) => {
  if (!value) return undefined;
  const timestamp = Date.parse(end && /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T23:59:59.999Z` : value);
  return Number.isFinite(timestamp) ? timestamp : undefined;
};

export async function GET(request: Request) {
  const actor = await requireApproved();
  if (!actor || actor.isPersonal || (actor.role !== "admin" && !actor.permissions.activity)) {
    return NextResponse.json({ error: "Activity access required" }, { status: 403 });
  }
  const url = new URL(request.url);
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit") || 25)));
  const cursor = Math.max(0, Number(url.searchParams.get("cursor") || 0));
  const categoryValue = url.searchParams.get("category") || "";
  const filters = {
    category: ACTIVITY_CATEGORIES.includes(categoryValue as typeof ACTIVITY_CATEGORIES[number]) ? categoryValue : undefined,
    actorUid: (url.searchParams.get("actor") || "").slice(0, 200) || undefined,
    from: parseDate(url.searchParams.get("from")),
    to: parseDate(url.searchParams.get("to"), true),
  };
  const results = [];
  const authors = await loadProjectAuthorDisplay(actor.projectId);
  let lastScanned = cursor;
  let exhausted = false;
  let scans = 0;
  while (results.length < limit && scans < 500 && !exhausted) {
    let query: FirebaseFirestore.Query = activityEvents(actor.projectId).orderBy("sequence", "desc").limit(Math.min(100, limit * 4));
    if (lastScanned > 0) query = query.startAfter(lastScanned);
    const snapshot = await query.get();
    if (snapshot.empty) { exhausted = true; break; }
    for (const document of snapshot.docs) {
      scans += 1;
      const data = document.data();
      lastScanned = Number(data.sequence || lastScanned);
      if (canViewActivity(actor, data) && activityMatches(data, filters)) results.push(serializeActivity(document, authors));
      if (results.length >= limit || scans >= 500) break;
    }
    exhausted = snapshot.size < Math.min(100, limit * 4);
  }
  console.info(JSON.stringify({ event: "activity_read", projectId: actor.projectId, actorUid: actor.uid, returned: results.length }));
  return NextResponse.json({ events: results, nextCursor: exhausted ? null : String(lastScanned || "") }, { headers: { "Cache-Control": "private, no-store" } });
}
