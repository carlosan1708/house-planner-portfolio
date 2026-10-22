import type { Transaction } from "firebase-admin/firestore";
import { firestore } from "./firebase-admin";
import { canAccessFolder } from "./auth";
import { appendActivity } from "./activity";
import { buildTopLevelFolderMap, folderTopLevelId, listProjectFolders } from "./folders";
import { DOCUMENTS, PROJECTS, type MemberRecord } from "./project";
import { parseHouseModel, parseCorrection, type DistributionRecord, type DistributionRequest } from "./house-distribution";

export class DistributionError extends Error { constructor(message: string, public status = 400) { super(message); } }
export const distributionRef = (projectId: string) => firestore.collection(PROJECTS).doc(projectId).collection("distribution").doc("current");
export const distributionRequestRef = (projectId: string) => firestore.collection(PROJECTS).doc(projectId).collection("distribution").doc("request");
export const distributionAllowed = (actor: MemberRecord) => actor.role === "admin" || (actor.permissions.distribution && actor.permissions.documents);
// Firestore rejects nested coordinate arrays. Keep geometry as bounded JSON, not nested Firestore arrays.
function storedDistribution(record: DistributionRecord) {
  const { model, ...rest } = record;
  const stored = { ...rest, modelJson: JSON.stringify(model) };
  if (Buffer.byteLength(JSON.stringify(stored), "utf8") > 900_000) throw new DistributionError("Model and corrections exceed the storage limit", 413);
  return stored;
}
function decodeDistribution(data: FirebaseFirestore.DocumentData | undefined): DistributionRecord | undefined {
  if (!data) return undefined;
  const { modelJson, ...rest } = data;
  return { ...rest, model: JSON.parse(modelJson) } as DistributionRecord;
}

export function sourceIds(value: unknown): string[] {
  if (!Array.isArray(value) || !value.length || value.length > 12 || value.some(id => typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,160}$/.test(id))) throw new DistributionError("Select up to 12 blueprint documents");
  return [...new Set(value)] as string[];
}

export async function checkDistributionSources(actor: MemberRecord, ids: string[], transaction?: Transaction) {
  if (actor.role !== "admin" && !actor.permissions.documents) throw new DistributionError("Blueprint access required", 403);
  const refs = sourceIds(ids).map(id => firestore.collection(DOCUMENTS).doc(id));
  const [docs, folders] = await Promise.all([transaction ? transaction.getAll(...refs) : firestore.getAll(...refs), listProjectFolders(actor.projectId)]);
  const map = buildTopLevelFolderMap(folders);
  const topIds: string[] = []; let unfiled = false;
  for (const doc of docs) {
    const data = doc.data(); const folderId = typeof data?.folderId === "string" ? data.folderId : null;
    const top = folderTopLevelId(folderId, map);
    if (data?.encrypted === true || folders.some((folder) => folder.id === top && folder.encrypted === true))
      throw new DistributionError("Encrypted documents cannot be used as blueprint sources", 403);
    if (!doc.exists || data?.projectId !== actor.projectId || data.deletedAt || !canAccessFolder(actor, folderId, top)) throw new DistributionError("Blueprint unavailable or access denied", 403);
    if (!/^(application\/pdf|image\/(png|jpeg|webp))$/.test(String(data.contentType))) throw new DistributionError("Blueprints must be PDF or image documents");
    if (top) topIds.push(top); else unfiled = true;
  }
  return { requiredTabs: ["distribution", "documents"] as ("distribution" | "documents")[], folderTopLevelIds: [...new Set(topIds)], allowUnfiledRequired: unfiled };
}

export async function readDistribution(actor: MemberRecord): Promise<DistributionRecord | null> {
  if (!distributionAllowed(actor)) throw new DistributionError("Distribution access required", 403);
  const doc = await distributionRef(actor.projectId).get();
  if (!doc.exists) return null;
  const record = decodeDistribution(doc.data())!;
  await checkDistributionSources(actor, record.model.sourceDocumentIds);
  return record;
}

export async function createDistributionRequest(actor: MemberRecord, ids: unknown, notes: unknown) {
  if (actor.role !== "admin") throw new DistributionError("Owner access required", 403);
  const ref = distributionRequestRef(actor.projectId);
  return firestore.runTransaction(async tx => {
    const existing = await tx.get(ref);
    if (existing.exists) return existing.data() as DistributionRequest;
    const selected = sourceIds(ids);
    await checkDistributionSources(actor, selected, tx);
    const record: DistributionRequest = { status: "requested", sourceDocumentIds: selected, notes: typeof notes === "string" ? notes.trim().slice(0, 2000) : "", preparationNotes: "", revision: 1, updatedAt: new Date().toISOString() };
    await appendActivity(tx, actor, { category: "project", action: "distribution.requested", target: { type: "distribution_request", id: "request", label: "3D distribution", section: "distribution" }, visibility: { adminOnly: true }, changes: [{ field: "status", before: null, after: "requested" }] });
    tx.set(ref, record); return record;
  });
}

export async function updateDistributionRequest(actor: MemberRecord, revision: unknown, preparationNotes: unknown) {
  if (actor.role !== "admin") throw new DistributionError("Admin access required", 403);
  const ref = distributionRequestRef(actor.projectId);
  return firestore.runTransaction(async tx => {
    const doc = await tx.get(ref); const before = doc.data() as DistributionRequest | undefined;
    if (!before) throw new DistributionError("Request not found", 404);
    if (before.revision !== revision || before.status === "ready") throw new DistributionError("Request changed. Reload before continuing.", 409);
    const record: DistributionRequest = { ...before, status: "in_preparation", preparationNotes: typeof preparationNotes === "string" ? preparationNotes.trim().slice(0, 2000) : "", revision: before.revision + 1, updatedAt: new Date().toISOString() };
    await appendActivity(tx, actor, { category: "project", action: "distribution.preparation_updated", target: { type: "distribution_request", id: "request", label: "3D distribution", section: "distribution" }, visibility: { adminOnly: true }, changes: [{ field: "status", before: before.status, after: record.status }, { field: "preparationNotes", before: before.preparationNotes, after: record.preparationNotes }] });
    tx.set(ref, record); return record;
  });
}

export async function importDistribution(actor: MemberRecord, value: unknown, expectedRevision: unknown) {
  if (actor.role !== "admin") throw new DistributionError("Admin access required", 403);
  const model = parseHouseModel(value);
  const ref = distributionRef(actor.projectId), requestRef = distributionRequestRef(actor.projectId);
  return firestore.runTransaction(async tx => {
    const [current, request] = await tx.getAll(ref, requestRef);
    const before = decodeDistribution(current.data());
    if ((before?.revision || 0) !== expectedRevision) throw new DistributionError("Model changed. Reload before importing.", 409);
    const visibility = await checkDistributionSources(actor, model.sourceDocumentIds, tx);
    // Preserve corrections for stable IDs across prepared geometry revisions.
    const roomCorrections = Object.fromEntries(Object.entries(before?.roomCorrections || {}).filter(([id]) => model.rooms.some(r => r.id === id)));
    const fixtureCorrections = Object.fromEntries(Object.entries(before?.fixtureCorrections || {}).filter(([id]) => model.fixtures.some(f => f.id === id)));
    for (const correction of Object.values(roomCorrections)) parseCorrection("room", correction, model);
    for (const correction of Object.values(fixtureCorrections)) parseCorrection("fixture", correction, model);
    const record: DistributionRecord = { model, roomCorrections, fixtureCorrections, revision: (before?.revision || 0) + 1, updatedAt: new Date().toISOString() };
    await appendActivity(tx, actor, { category: "project", action: "distribution.imported", target: { type: "distribution", id: "current", label: model.name, section: "distribution" }, visibility, changes: [{ field: "revision", before: before?.revision || null, after: record.revision }] });
    tx.set(ref, storedDistribution(record));
    tx.set(requestRef, { status: "ready", sourceDocumentIds: model.sourceDocumentIds, notes: request.data()?.notes || "", preparationNotes: request.data()?.preparationNotes || "", revision: Number(request.data()?.revision || 0) + 1, updatedAt: record.updatedAt });
    return record;
  });
}

export async function correctDistribution(actor: MemberRecord, body: Record<string, unknown>) {
  if (!distributionAllowed(actor) || actor.role === "viewer") throw new DistributionError("Distribution editor access required", 403);
  if (body.kind !== "room" && body.kind !== "fixture") throw new DistributionError("Invalid correction target");
  const kind = body.kind, ref = distributionRef(actor.projectId);
  return firestore.runTransaction(async tx => {
    const doc = await tx.get(ref); const before = decodeDistribution(doc.data());
    if (!before) throw new DistributionError("Model not found", 404);
    if (body.revision !== before.revision) throw new DistributionError("Model changed. Reload before saving.", 409);
    const visibility = await checkDistributionSources(actor, before.model.sourceDocumentIds, tx);
    const items = kind === "room" ? before.model.rooms : before.model.fixtures;
    const item = items.find(i => i.id === body.id); if (!item) throw new DistributionError("Item not found", 404);
    let correction;
    try { correction = parseCorrection(kind, body.correction, before.model); }
    catch (error) { throw new DistributionError(error instanceof Error ? error.message : "Invalid correction"); }
    const key = kind === "room" ? "roomCorrections" : "fixtureCorrections";
    const old = before[key][item.id] || {};
    const merged = body.reset === true ? {} : { ...old, ...correction };
    const record = { ...before, [key]: { ...before[key], [item.id]: merged }, revision: before.revision + 1, updatedAt: new Date().toISOString() };
    await appendActivity(tx, actor, { category: "project", action: "distribution.corrected", target: { type: kind, id: item.id, label: "name" in item ? item.name : item.type, section: "distribution" }, visibility, changes: [{ field: "correction", before: old, after: merged }] });
    tx.set(ref, storedDistribution(record)); return record;
  });
}
