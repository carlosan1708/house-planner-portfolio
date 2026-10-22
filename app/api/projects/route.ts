import { cookies } from "next/headers";
import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { getSessionMember, requireApproved } from "@/lib/auth";
import { ACTIVE_PROJECT_COOKIE, AESTHETIC_FOLDERS, DEFAULT_FOLDER_ACCESS, DEFAULT_MEMBER_PERMISSIONS, LEGACY_PROJECT_ID, MEMBERSHIPS, membershipId, personalProjectId, PROJECTS, projectScopedId, USERS } from "@/lib/project";
import { firestore } from "@/lib/firebase-admin";
import { ensureExpenseInvoiceFolder, ensureExpensePurchaseFolder } from "@/lib/folders";
import { DEFAULT_AESTHETIC_FOLDERS } from "@/lib/aesthetics";
import { appendActivity, commitActivity } from "@/lib/activity";
import { resolveMembershipAccess } from "@/lib/access-links";
import { isProjectCurrency, projectCurrency } from "@/lib/currency";
import { currencyRevision, projectCurrencyLocked } from "@/lib/project-currency";
import { recordActivityUsage } from "@/lib/usage-actions";
import { prepareProjectCurrencyCorrection } from "@/lib/project-currency-correction";

export async function GET() {
  const actor = await getSessionMember();
  if (!actor) return NextResponse.json({ error: "Authentication required" }, { status: 403 });
  if (actor.anonymousLink) {
    return NextResponse.json({ projects: [{ id: actor.projectId, name: actor.projectName, currency: projectCurrency(actor.projectCurrency), currencyRevision: 0, currencyLocked: true, kind: actor.isPersonal ? "personal" : "shared", role: "viewer", active: true, favorite: false, openOnSignIn: false }] });
  }
  const personalId = personalProjectId(actor.uid);
  const personalMembershipRef = firestore.collection(MEMBERSHIPS).doc(membershipId(personalId, actor.uid));
  const activeMembershipRef = firestore.collection(MEMBERSHIPS).doc(membershipId(actor.projectId, actor.uid));
  const [personalMembership, activeMembership] = await Promise.all([personalMembershipRef.get(), activeMembershipRef.get()]);
  const batch = firestore.batch();
  let hasWrites = false;
  if (!personalMembership.exists) {
    hasWrites = true;
    batch.set(firestore.collection(PROJECTS).doc(personalId), { id: personalId, name: "Mi espacio", kind: "personal", ownerUid: actor.uid, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    batch.set(personalMembershipRef, { projectId: personalId, uid: actor.uid, role: "admin", status: "approved", permissions: DEFAULT_MEMBER_PERMISSIONS, folderAccess: DEFAULT_FOLDER_ACCESS, joinedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  }
  if (actor.status === "approved" && actor.projectId !== personalId && !activeMembership.exists) {
    hasWrites = true;
    batch.set(firestore.collection(PROJECTS).doc(actor.projectId), { id: actor.projectId, name: actor.projectName || (actor.projectId === LEGACY_PROJECT_ID ? "Sample House" : "Project"), kind: actor.isPersonal ? "personal" : "shared", updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    batch.set(activeMembershipRef, { projectId: actor.projectId, uid: actor.uid, role: actor.role, status: "approved", permissions: actor.permissions, folderAccess: actor.folderAccess, joinedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  }
  if (hasWrites) await batch.commit();
  if (actor.role === "admin" && actor.projectId !== personalId) {
    await Promise.all([ensureExpenseInvoiceFolder(actor.projectId, actor.email), ensureExpensePurchaseFolder(actor.projectId, actor.email)]);
  }
  const snapshot = await firestore.collection(MEMBERSHIPS).where("uid", "==", actor.uid).get();
  const resolvedMemberships = await Promise.all(snapshot.docs.map(async (document) => ({ document, data: await resolveMembershipAccess(document.data()) })));
  const memberships = resolvedMemberships.filter(({ data }) => data.status === "approved");
  const identity = await firestore.collection(USERS).doc(actor.uid).get();
  const favoriteProjectId = typeof identity.data()?.favoriteProjectId === "string" ? String(identity.data()?.favoriteProjectId) : "";
  const openFavoriteOnSignIn = identity.data()?.openFavoriteOnSignIn === true && memberships.some(({ data }) => String(data.projectId) === favoriteProjectId);
  const projects = await Promise.all(memberships.map(async (membership) => {
    const data = membership.data; const project = await firestore.collection(PROJECTS).doc(String(data.projectId)).get();
    const id = String(data.projectId);
    const kind = project.data()?.kind === "personal" ? "personal" : "shared";
    const projectData = project.data() || {};
    return { id, name: String(projectData.name || "Project"), currency: projectCurrency(projectData.currency), currencyRevision: currencyRevision(projectData.currencyRevision), currencyLocked: await projectCurrencyLocked(id, projectData), kind, role: data.role === "admin" || data.role === "viewer" ? data.role : "editor", active: id === actor.projectId, favorite: kind === "shared" && id === favoriteProjectId, openOnSignIn: kind === "shared" && id === favoriteProjectId && openFavoriteOnSignIn };
  }));
  return NextResponse.json({ projects: projects.sort((a, b) => Number(b.kind === "personal") - Number(a.kind === "personal") || Number(b.favorite) - Number(a.favorite) || a.name.localeCompare(b.name)) });
}

export async function POST(request: Request) {
  const actor = await requireApproved();
  if (!actor) return NextResponse.json({ error: "Authentication required" }, { status: 403 });
  if (actor.anonymousLink) return NextResponse.json({ error: "This link is read-only" }, { status: 403 });
  const body = await request.json().catch(() => null) as { name?: unknown; currency?: unknown } | null;
  if (!body) return NextResponse.json({ error: "Invalid project" }, { status: 400 });
  if (body.currency !== undefined && !isProjectCurrency(body.currency)) return NextResponse.json({ error: "Select CRC or USD" }, { status: 400 });
  const currency = projectCurrency(body.currency);
  const name = typeof body.name === "string" ? body.name.trim().replace(/\s+/g, " ") : "";
  if (name.length < 2 || name.length > 80) {
    return NextResponse.json({ error: "Project name must contain 2 to 80 characters" }, { status: 400 });
  }
  const projectRef = firestore.collection(PROJECTS).doc();
  const membershipRef = firestore.collection(MEMBERSHIPS).doc(membershipId(projectRef.id, actor.uid));
  const defaultAestheticFolders = DEFAULT_AESTHETIC_FOLDERS.map((folder) => ({
    ...folder,
    ref: firestore.collection(AESTHETIC_FOLDERS).doc(projectScopedId(projectRef.id, `aesthetic-${folder.key}`)),
  }));
  const projectRecord = {
    id: projectRef.id,
    name,
    currency,
    currencyRevision: 0,
    currencyLocked: false,
    kind: "shared",
    ownerUid: actor.uid,
    createdBy: actor.email,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
  const membershipRecord = {
    projectId: projectRef.id,
    uid: actor.uid,
    role: "admin",
    status: "approved",
    permissions: DEFAULT_MEMBER_PERMISSIONS,
    folderAccess: DEFAULT_FOLDER_ACCESS,
    joinedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
  await commitActivity({ ...actor, projectId: projectRef.id, role: "admin" }, {
    category: "project", action: "project.created",
    target: { type: "project", id: projectRef.id, label: name, section: "overview" },
    changes: [{ field: "status", before: null, after: "created", format: "status" }],
  }, (transaction) => {
    transaction.set(projectRef, projectRecord);
    transaction.set(membershipRef, membershipRecord);
    for (const folder of defaultAestheticFolders) transaction.set(folder.ref, {
      projectId: projectRef.id,
      name: folder.name,
      kind: folder.kind,
      sortOrder: folder.sortOrder,
      carouselImageIds: [],
      createdBy: actor.email,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
  const response = NextResponse.json({ ok: true, project: { id: projectRef.id, name, currency, currencyRevision: 0, currencyLocked: false, kind: "shared", role: "admin", active: true } }, { status: 201 });
  response.cookies.set(ACTIVE_PROJECT_COOKIE, projectRef.id, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 30 * 24 * 60 * 60 });
  return response;
}

export async function PATCH(request: Request) {
  const actor = await getSessionMember();
  if (!actor) return NextResponse.json({ error: "Authentication required" }, { status: 403 });
  if (actor.anonymousLink) return NextResponse.json({ error: "This link is read-only" }, { status: 403 });
  const body = await request.json().catch(() => null) as { action?: string; projectId?: string; enabled?: boolean; currency?: unknown; expectedCurrencyRevision?: unknown; confirmDenominationCorrection?: unknown } | null;
  if (!body) return NextResponse.json({ error: "Invalid project action" }, { status: 400 });
  const action = body.action || "switch";
  const projectId = String(body.projectId || "");
  if (action === "currency") {
    if (!isProjectCurrency(body.currency) || !Number.isSafeInteger(body.expectedCurrencyRevision) || Number(body.expectedCurrencyRevision) < 0 || !/^[a-zA-Z0-9_-]{1,200}$/.test(projectId)
      || body.confirmDenominationCorrection !== undefined && typeof body.confirmDenominationCorrection !== "boolean")
      return NextResponse.json({ error: "A project, supported currency and currency revision are required" }, { status: 400 });
    const membershipRef = firestore.collection(MEMBERSHIPS).doc(membershipId(projectId, actor.uid));
    const membership = await membershipRef.get();
    const grant = membership.exists ? await resolveMembershipAccess(membership.data()!) : null;
    if (!grant || grant.projectId !== projectId || grant.uid !== actor.uid || grant.status !== "approved" || grant.role !== "admin" || grant.accessLinkId)
      return NextResponse.json({ error: "Project administrator access required" }, { status: 403 });
    const projectRef = firestore.collection(PROJECTS).doc(projectId);
    const requestedCurrency = body.currency;
    const confirmed = body.confirmDenominationCorrection === true;
    let prepared: Awaited<ReturnType<typeof prepareProjectCurrencyCorrection>> | null = null;
    let committed = false;
    try {
      const opening = await projectRef.get();
      if (!opening.exists) throw new Error("currency_project_not_found");
      const openingData = opening.data()!;
      const sourceCurrency = projectCurrency(openingData.currency);
      if (currencyRevision(openingData.currencyRevision) !== body.expectedCurrencyRevision) throw new Error("currency_stale");
      if (sourceCurrency !== requestedCurrency) {
        const locked = await projectCurrencyLocked(projectId, openingData);
        if (locked && !confirmed) throw new Error("currency_confirmation_required");
        if (locked) prepared = await prepareProjectCurrencyCorrection(projectId, sourceCurrency, requestedCurrency);
      }
      const result = await firestore.runTransaction(async (transaction) => {
        const [project, currentMembership] = await transaction.getAll(projectRef, membershipRef);
        const currentGrant = currentMembership.data();
        if (!currentMembership.exists || currentGrant?.projectId !== projectId || currentGrant.uid !== actor.uid || currentGrant.status !== "approved" || currentGrant.role !== "admin" || currentGrant.removed === true || currentGrant.accessLinkId)
          throw new Error("currency_access_denied");
        if (!project.exists) throw new Error("currency_project_not_found");
        const data = project.data()!;
        const currency = projectCurrency(data.currency), revision = currencyRevision(data.currencyRevision);
        if (revision !== body.expectedCurrencyRevision || currency !== sourceCurrency) throw new Error("currency_stale");
        const locked = await projectCurrencyLocked(projectId, data, transaction);
        const responseProject = { id: projectId, currency, currencyRevision: revision, currencyLocked: locked };
        if (currency === requestedCurrency) return { project: responseProject, event: null };
        if (locked && !confirmed) throw new Error("currency_confirmation_required");
        if (locked && !prepared) throw new Error("currency_stale");
        await prepared?.validate(transaction);
        const activity = { category: "project" as const, action: "project.currency_updated", target: { type: "project", id: projectId, label: String(data.name || "Project"), section: "overview" as const }, summaryParams: { denominationCorrection: Boolean(prepared), confirmationReceived: Boolean(prepared && confirmed), amountsConverted: false, ...(prepared ? { paymentCount: prepared.paymentCount, planVersion: prepared.planVersion, actualsRevision: prepared.actualsRevision } : {}) }, changes: [{ field: "currency", before: currency, after: requestedCurrency, format: "text" as const }] };
        const event = await appendActivity(transaction, { ...actor, projectId, role: "admin" }, activity);
        prepared?.write(transaction);
        transaction.set(projectRef, { currency: requestedCurrency, currencyRevision: revision + 1, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
        return { project: { ...responseProject, currency: requestedCurrency, currencyRevision: revision + 1 }, event: { activity, id: event.id } };
      });
      committed = true;
      if (result.event) await recordActivityUsage({ ...actor, projectId }, result.event.activity, result.event.id);
      let synchronization: { googleSynced: boolean; googleSyncError?: string } | undefined;
      if (prepared && result.event) {
        try { synchronization = await prepared.afterCommit(); }
        catch { synchronization = { googleSynced: false, googleSyncError: "Google synchronization is pending. The project currency was saved." }; }
      }
      return NextResponse.json({ ok: true, project: result.project, ...(prepared && result.event ? { correction: { sourceCurrency, currency: requestedCurrency, amountsConverted: false, paymentCount: prepared.paymentCount, planVersion: prepared.planVersion, actualsRevision: prepared.actualsRevision } } : {}), ...(synchronization ? { synchronization } : {}) });
    } catch (error) {
      if (prepared && !committed) await prepared.cleanup().catch(() => { console.warn("Uncommitted currency correction cleanup is pending"); });
      const code = error instanceof Error ? error.message : "currency_unavailable";
      const errors: Record<string, [number, string]> = {
        currency_access_denied: [403, "Project administrator access required"],
        currency_project_not_found: [404, "Project not found"],
        currency_stale: [409, "Project settings changed. Refresh and try again."],
        currency_confirmation_required: [409, "Confirm that all existing numbers remain unchanged and only the project denomination is corrected. No currency conversion is performed."],
        currency_scope_limit: [413, "This project exceeds the supported denomination-correction size. Its currency was not changed."],
        currency_unsupported_workbook: [422, "The workbook contains unsupported features that prevent a safe denomination correction. Its currency was not changed."],
        currency_source_unavailable: [503, "The official workbook is unavailable. The project currency was not changed."],
      };
      const [status, message] = errors[code] || [503, "Project currency could not be updated"];
      return NextResponse.json({ code: errors[code] ? code : "currency_unavailable", error: message }, { status });
    }
  }
  if (action === "open_favorite") {
    const identityRef = firestore.collection(USERS).doc(actor.uid);
    const identity = await identityRef.get();
    const favoriteProjectId = typeof identity.data()?.favoriteProjectId === "string" ? String(identity.data()?.favoriteProjectId) : "";
    if (body.enabled && favoriteProjectId) {
      const favoriteMembership = await firestore.collection(MEMBERSHIPS).doc(membershipId(favoriteProjectId, actor.uid)).get();
      if (!favoriteMembership.exists || (await resolveMembershipAccess(favoriteMembership.data()!)).status !== "approved") return NextResponse.json({ error: "Favorite project access required" }, { status: 403 });
    }
    await identityRef.set({ openFavoriteOnSignIn: body.enabled === true && Boolean(favoriteProjectId), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return NextResponse.json({ ok: true, openFavoriteOnSignIn: body.enabled === true && Boolean(favoriteProjectId) });
  }
  const membership = await firestore.collection(MEMBERSHIPS).doc(membershipId(projectId, actor.uid)).get();
  if (!membership.exists || (await resolveMembershipAccess(membership.data()!)).status !== "approved") return NextResponse.json({ error: "Project access required" }, { status: 403 });
  if (action === "favorite") {
    if (projectId === personalProjectId(actor.uid)) return NextResponse.json({ error: "Only projects can be favorites" }, { status: 400 });
    const identityRef = firestore.collection(USERS).doc(actor.uid);
    const identity = await identityRef.get();
    const clearing = identity.data()?.favoriteProjectId === projectId;
    await identityRef.set({ favoriteProjectId: clearing ? FieldValue.delete() : projectId, ...(clearing || projectId === personalProjectId(actor.uid) ? { openFavoriteOnSignIn: false } : {}), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return NextResponse.json({ ok: true, favoriteProjectId: clearing ? null : projectId });
  }
  if (action !== "switch") return NextResponse.json({ error: "Unsupported project action" }, { status: 400 });
  const response = NextResponse.json({ ok: true, projectId }); const maxAge = 30 * 24 * 60 * 60;
  (await cookies()).set(ACTIVE_PROJECT_COOKIE, projectId, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge });
  return response;
}
