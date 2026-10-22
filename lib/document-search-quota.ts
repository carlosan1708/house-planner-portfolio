import { createHash } from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";
import { firestore } from "./firebase-admin";
import type { MemberRecord } from "./project";
import { DocumentSearchFailure } from "./document-search-policy";

export const DOCUMENT_SEARCH_USAGE = "housePlannerDocumentSearchUsage";
export const DOCUMENT_SEARCH_LIMITS = { userDay: 20, projectDay: 100, projectMonth: 1000, cooldownMs: 10_000 } as const;
const key = (parts: string[]) => createHash("sha256").update(JSON.stringify(parts)).digest("hex");
const count = (data: FirebaseFirestore.DocumentData | undefined) => {
  const value = data ? data.count : 0;
  if (!Number.isInteger(value) || value < 0) throw new DocumentSearchFailure("semantic_unavailable", 503);
  return value as number;
};

/** Reserve before the provider call; failures and cancellations remain counted across instances. */
export async function reserveDocumentSearch(actor: Pick<MemberRecord, "uid" | "projectId">, now = Date.now()) {
  const date = new Date(now), day = date.toISOString().slice(0, 10), month = day.slice(0, 7);
  const nextDay = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
  const nextMonth = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
  const scopes = [
    { parts: ["user-day", actor.uid, day], limit: DOCUMENT_SEARCH_LIMITS.userDay, reset: nextDay },
    { parts: ["project-day", actor.projectId, day], limit: DOCUMENT_SEARCH_LIMITS.projectDay, reset: nextDay },
    { parts: ["project-month", actor.projectId, month], limit: DOCUMENT_SEARCH_LIMITS.projectMonth, reset: nextMonth },
  ];
  const refs = scopes.map(scope => firestore.collection(DOCUMENT_SEARCH_USAGE).doc(key(scope.parts)));
  const cooldown = firestore.collection(DOCUMENT_SEARCH_USAGE).doc(key(["cooldown", actor.uid]));
  await firestore.runTransaction(async transaction => {
    const snapshots = await transaction.getAll(...refs, cooldown);
    const last = snapshots[3].data()?.lastReservedAtMs;
    if (last !== undefined && (typeof last !== "number" || !Number.isFinite(last) || last < 0))
      throw new DocumentSearchFailure("semantic_unavailable", 503);
    const retryAfter = typeof last === "number" ? Math.ceil((last + DOCUMENT_SEARCH_LIMITS.cooldownMs - now) / 1000) : 0;
    if (retryAfter > 0) throw new DocumentSearchFailure("search_limit", 429, retryAfter);
    const counts = snapshots.slice(0, 3).map(snapshot => count(snapshot.data()));
    for (let index = 0; index < scopes.length; index += 1) {
      if (counts[index] >= scopes[index].limit)
        throw new DocumentSearchFailure("search_limit", 429, Math.max(1, Math.ceil((scopes[index].reset - now) / 1000)));
    }
    refs.forEach((ref, index) => transaction.set(ref, {
      count: counts[index] + 1, expiresAt: Timestamp.fromMillis(scopes[index].reset + 86_400_000),
    }));
    transaction.set(cooldown, { lastReservedAtMs: now, expiresAt: Timestamp.fromMillis(now + 172_800_000) });
  });
}
