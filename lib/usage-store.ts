import { createHash, randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { FieldPath, FieldValue, Timestamp, type DocumentData, type DocumentReference, type Query } from "firebase-admin/firestore";
import { firestore } from "./firebase-admin";
import { PROJECTS, type MemberRecord, type WorkspaceTab } from "./project";
import { configuredQaCompanionEmail, configuredQaEmails, configuredQaProjectIds } from "./qa-reset-policy";
import { addUsageDays, isUsageOwner, USAGE_COOKIE, USAGE_RETENTION_DAYS, USAGE_SERVER_ACTIONS, USAGE_SESSION_MS, UsageError, summarizeUsage, usageDay, usageDays, usageScope } from "./usage";
import type { UsageAnalyticsFilter, UsageAnalyticsResponse, UsageDailyRow, UsageEvent } from "./usage-types";
import { DEACTIVATED_USER_NAME, loadProjectAuthorDisplay } from "./project-authors";

export const ANALYTICS_COLLECTIONS = {
  browsers: "housePlannerAnalyticsBrowsers",
  sessions: "housePlannerAnalyticsSessions",
  scopes: "housePlannerAnalyticsScopeSessions",
  events: "housePlannerAnalyticsEvents",
  days: "housePlannerAnalyticsDays",
  metadata: "housePlannerAnalyticsMetadata",
} as const;
const ROWS = "usageRows";
const PAGE_SIZE = 400;
type UsageActor = Pick<MemberRecord, "uid" | "email" | "projectId"> & Partial<Pick<MemberRecord, "name" | "role" | "projectName" | "anonymousLink">>;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const expiry = (now: number) => Timestamp.fromMillis(now + USAGE_RETENTION_DAYS * 86_400_000);

export function usageVisitor(value?: string) {
  return value && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) ? value : randomUUID();
}

export const usageCookieOptions = {
  httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/", maxAge: USAGE_RETENTION_DAYS * 86_400,
};

export function isQaUsage(actor: UsageActor | null, projectIds: string[] = []) {
  if (process.env.HOUSE_PLANNER_ENVIRONMENT === "qa") return true;
  const qaEmails = configuredQaEmails();
  qaEmails.add("qa.houseplanner.20260830@example.com");
  qaEmails.add(configuredQaCompanionEmail());
  return Boolean(actor && qaEmails.has(actor.email.trim().toLowerCase())) || projectIds.some(projectId => configuredQaProjectIds().has(projectId));
}

function rowRef(day: string, scope: string, browserKey: string, uid: string | null, owner: boolean) {
  return firestore.collection(ANALYTICS_COLLECTIONS.days).doc(day).collection(ROWS).doc(hash(JSON.stringify([scope, browserKey, uid, owner])));
}

function newRow(day: string, scope: string, browserKey: string, actor: UsageActor | null, owner: boolean): UsageDailyRow {
  return {
    day, scope, context: scope === "global" ? "all" : scope.startsWith("project:") ? "project" : scope as "access" | "demo",
    projectId: scope.startsWith("project:") ? scope.slice(8) : null,
    browserKey, uid: actor?.uid || null, name: actor?.name || actor?.email || "", email: actor?.email || "", owner,
    lastAt: 0, visits: 0, views: 0, actions: 0, activeMs: 0, sections: {},
  };
}

/** Receipts, shared session state and both summaries commit atomically across instances. */
export async function ingestUsage(visitor: string, actor: UsageActor | null, events: UsageEvent[], now = Date.now(), serverAction = false) {
  const meaningful = events.filter(event => event.kind !== "active" || (event.activeMs || 0) > 0);
  if (!meaningful.length || isQaUsage(actor, meaningful.flatMap(event => event.projectId ? [event.projectId] : []))) return { accepted: 0, excluded: true };
  // Public-link guests are browser visitors; their synthetic UID is not an account.
  actor = actor?.anonymousLink === true ? null : actor;
  const browserKey = hash(visitor);
  const browserRef = firestore.collection(ANALYTICS_COLLECTIONS.browsers).doc(browserKey);
  const receiptRefs = meaningful.map(event => firestore.collection(ANALYTICS_COLLECTIONS.events).doc(hash(serverAction ? `server:${event.id}` : `client:${browserKey}:${event.id}`)));
  const newSessionId = randomUUID();
  const owner = Boolean(actor && isUsageOwner(actor.email, process.env.HOUSE_PLANNER_ADMIN_EMAIL));
  const day = usageDay(now);
  const dayRef = firestore.collection(ANALYTICS_COLLECTIONS.days).doc(day);
  const metadataRef = firestore.collection(ANALYTICS_COLLECTIONS.metadata).doc("usage");
  const result = await firestore.runTransaction(async transaction => {
    const [browser] = await transaction.getAll(browserRef);
    const previous = browser.data() || {};
    const rateWindow = Math.floor(now / 60_000);
    const requests = previous.rateWindow === rateWindow ? Number(previous.requests || 0) : 0;
    const eventCount = previous.rateWindow === rateWindow ? Number(previous.eventCount || 0) : 0;
    if (!serverAction && requests >= 30) throw new UsageError("Analytics rate exceeded", 429);
    const [metadata, ...receipts] = await transaction.getAll(metadataRef, ...receiptRefs);
    const seen = new Set<string>();
    const accepted = meaningful.flatMap((event, index) => {
      if (receipts[index].exists || seen.has(event.id)) return [];
      seen.add(event.id); return [{ event, ref: receiptRefs[index] }];
    });
    if (!accepted.length) {
      if (!serverAction) transaction.set(browserRef, { rateWindow, requests: requests + 1, eventCount }, { merge: true });
      return { accepted: 0, excluded: false };
    }
    if (!serverAction && eventCount + accepted.length > 120) {
      transaction.set(browserRef, { rateWindow, requests: requests + 1, eventCount }, { merge: true });
      return { accepted: 0, excluded: false, rateLimited: true };
    }
    const continuing = Boolean(previous.sessionId) && now - Number(previous.lastAt || 0) < USAGE_SESSION_MS;
    const sessionId = continuing ? String(previous.sessionId) : newSessionId;
    const sessionStartedAt = continuing ? Number(previous.sessionStartedAt || now) : now;
    const sessionRef = firestore.collection(ANALYTICS_COLLECTIONS.sessions).doc(sessionId);
    const scopes = [...new Set(["global", ...accepted.map(({ event }) => usageScope(event))])];
    const scopeRefs = scopes.map(scope => firestore.collection(ANALYTICS_COLLECTIONS.scopes).doc(hash(`${sessionId}:${scope}`)));
    const rowRefs = scopes.map(scope => rowRef(day, scope, browserKey, actor?.uid || null, owner));
    const snapshots = await transaction.getAll(...scopeRefs, ...rowRefs);
    const scopeExists = new Map(scopes.map((scope, index) => [scope, snapshots[index].exists]));
    const rows = new Map(scopes.map((scope, index) => [scope, snapshots[index + scopes.length].exists ? snapshots[index + scopes.length].data() as UsageDailyRow : newRow(day, scope, browserKey, actor, owner)]));
    let lastActiveAt = continuing ? Number(previous.lastActiveAt || sessionStartedAt) : now;
    let activeBudget = Math.max(0, now - Math.max(lastActiveAt, sessionStartedAt));
    for (const { event, ref } of accepted) {
      const activeMs = event.kind === "active" ? Math.min(event.activeMs || 0, 60_000, activeBudget) : 0;
      if (event.kind === "active") { activeBudget -= activeMs; lastActiveAt = now; }
      for (const scope of ["global", usageScope(event)]) {
        const row = rows.get(scope)!;
        const visits = scopeExists.get(scope) ? 0 : 1;
        scopeExists.set(scope, true);
        const views = event.kind === "view" ? 1 : 0;
        const actions = event.kind === "interaction" ? 1 : 0;
        row.visits += visits; row.views += views; row.actions += actions; row.activeMs += activeMs; row.lastAt = now;
        row.name = actor?.name || actor?.email || ""; row.email = actor?.email || "";
        const counters = row.sections[event.section] ||= { visits: 0, views: 0, actions: 0, activeMs: 0 };
        counters.visits += visits; counters.views += views; counters.actions += actions; counters.activeMs += activeMs;
      }
      transaction.set(ref, { ...event, browserKey, uid: actor?.uid || null, owner, activeMs, sessionId, occurredAt: Timestamp.fromMillis(now), expiresAt: expiry(now) });
    }
    transaction.set(browserRef, { sessionId, sessionStartedAt, lastAt: now, lastActiveAt, ownerAssociated: owner || previous.ownerAssociated === true, expiresAt: expiry(now), rateWindow, requests: serverAction ? requests : requests + 1, eventCount: serverAction ? eventCount : eventCount + accepted.length }, { merge: true });
    transaction.set(sessionRef, { browserKey, startedAt: Timestamp.fromMillis(sessionStartedAt), lastAt: Timestamp.fromMillis(now), expiresAt: expiry(now) }, { merge: true });
    scopes.forEach((scope, index) => {
      const first = snapshots[index].data()?.firstDay || day;
      transaction.set(scopeRefs[index], { sessionId, scope, firstDay: first, expiresAt: expiry(now) }, { merge: true });
      // Preserve the complete last supported calendar day until its local midnight expires.
      const expiresAt = Timestamp.fromDate(new Date(`${addUsageDays(day, USAGE_RETENTION_DAYS)}T00:00:00-06:00`));
      transaction.set(rowRefs[index], { ...rows.get(scope)!, expiresAt });
    });
    transaction.set(dayRef, { expiresAt: Timestamp.fromDate(new Date(`${addUsageDays(day, USAGE_RETENTION_DAYS)}T00:00:00-06:00`)) }, { merge: true });
    if (!metadata.exists) transaction.set(metadataRef, { startedAt: FieldValue.serverTimestamp(), schemaVersion: 1 });
    return { accepted: accepted.length, excluded: false };
  });
  if (result.rateLimited) throw new UsageError("Analytics rate exceeded", 429);
  return { accepted: result.accepted, excluded: result.excluded };
}

/** Authorized routes call after success. Analytics failures never change a business result. */
export async function recordUsageAction(actor: UsageActor, action: string, section: WorkspaceTab, operationId: string): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    if (!USAGE_SERVER_ACTIONS.includes(action as typeof USAGE_SERVER_ACTIONS[number]) || !operationId || isQaUsage(actor, [actor.projectId])) return;
    await Promise.race([
      (async () => {
        const cookieStore = await cookies();
        const visitor = usageVisitor(cookieStore.get(USAGE_COOKIE)?.value);
        if (cookieStore.get(USAGE_COOKIE)?.value !== visitor) cookieStore.set(USAGE_COOKIE, visitor, usageCookieOptions);
        const id = hash(JSON.stringify([actor.uid, actor.projectId, action, operationId]));
        await ingestUsage(visitor, actor, [{ id, kind: "interaction", context: "project", section, projectId: actor.projectId, action }], Date.now(), true);
      })(),
      new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error("usage_timeout")), 1500); }),
    ]);
  } catch { console.warn(JSON.stringify({ module: "analytics", code: "server_action_unavailable" })); }
  finally { if (timeout) clearTimeout(timeout); }
}

async function readPages(query: Query, consume: (data: DocumentData, id: string) => void) {
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;
  for (;;) {
    const page = await (cursor ? query.startAfter(cursor) : query).limit(PAGE_SIZE).get();
    for (const document of page.docs) consume(document.data(), document.id);
    if (page.size < PAGE_SIZE) break;
    cursor = page.docs.at(-1);
  }
}

export async function readUsageAnalytics(filters: UsageAnalyticsFilter): Promise<UsageAnalyticsResponse> {
  const rows: UsageDailyRow[] = [];
  const projectOptions: UsageAnalyticsResponse["projectOptions"] = [];
  // Each query selects a known calendar day; no historical event scan or composite index.
  for (const day of usageDays(filters.from, filters.to)) await readPages(firestore.collection(ANALYTICS_COLLECTIONS.days).doc(day).collection(ROWS).orderBy(FieldPath.documentId()), data => rows.push(data as UsageDailyRow));
  await readPages(firestore.collection(PROJECTS).orderBy(FieldPath.documentId()), (data, projectId) => {
    if (!configuredQaProjectIds().has(projectId)) projectOptions.push({ projectId, name: String(data.name || projectId) });
  });
  projectOptions.sort((a, b) => a.name.localeCompare(b.name));
  const metadata = await firestore.collection(ANALYTICS_COLLECTIONS.metadata).doc("usage").get();
  const startedAt = metadata.data()?.startedAt?.toDate?.()?.toISOString() || null;
  const ownerBrowserKeys = new Set<string>();
  if (!filters.includeOwner) {
    const anonymousKeys = [...new Set(rows.filter(row => !row.uid).map(row => row.browserKey))];
    for (let offset = 0; offset < anonymousKeys.length; offset += PAGE_SIZE) {
      const documents = await firestore.getAll(...anonymousKeys.slice(offset, offset + PAGE_SIZE).map(key => firestore.collection(ANALYTICS_COLLECTIONS.browsers).doc(key)));
      documents.forEach(document => { if (document.data()?.ownerAssociated === true) ownerBrowserKeys.add(document.id); });
    }
  }
  let reportedRows = rows;
  if (filters.context === "project" && filters.projectId) {
    const authors = await loadProjectAuthorDisplay(filters.projectId);
    reportedRows = rows.map((row) => row.projectId === filters.projectId && authors.isDeactivated(row.uid, row.email, row.lastAt)
      ? { ...row, name: DEACTIVATED_USER_NAME, email: "" } : row);
  }
  return summarizeUsage(reportedRows, filters, startedAt, projectOptions, ownerBrowserKeys);
}

async function deleteReferences(refs: DocumentReference[]) {
  if (!refs.length) return;
  const batch = firestore.batch();
  refs.forEach(ref => batch.delete(ref));
  await batch.commit();
}

export async function cleanupUsage(now = Date.now()) {
  let deleted = 0;
  // Delete child rows before their expired day parent; parent deletion does not cascade.
  const expiredDays = firestore.collection(ANALYTICS_COLLECTIONS.days).where("expiresAt", "<=", Timestamp.fromMillis(now)).orderBy("expiresAt");
  for (;;) {
    const days = await expiredDays.limit(PAGE_SIZE).get();
    if (days.empty) break;
    for (const day of days.docs) {
      for (;;) {
        const rows = await day.ref.collection(ROWS).limit(PAGE_SIZE).get();
        if (rows.empty) break;
        await deleteReferences(rows.docs.map(row => row.ref)); deleted += rows.size;
      }
      await day.ref.delete(); deleted++;
    }
  }
  for (const collection of [ANALYTICS_COLLECTIONS.events, ANALYTICS_COLLECTIONS.scopes, ANALYTICS_COLLECTIONS.sessions, ANALYTICS_COLLECTIONS.browsers]) {
    for (;;) {
      const page = await firestore.collection(collection).where("expiresAt", "<=", Timestamp.fromMillis(now)).orderBy("expiresAt").limit(PAGE_SIZE).get();
      if (page.empty) break;
      await deleteReferences(page.docs.map(document => document.ref)); deleted += page.size;
    }
  }
  return { deleted, completedAt: new Date(now).toISOString() };
}
