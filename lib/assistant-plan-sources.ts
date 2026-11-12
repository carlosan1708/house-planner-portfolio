import { firestore } from "./firebase-admin";
import { aestheticFolderKind } from "./aesthetics";
import { listProjectFolders } from "./folders";
import { AESTHETIC_FOLDERS, AESTHETIC_IMAGES, DOCUMENTS, projectStoragePrefix, type MemberRecord } from "./project";
import { canReadRagSource, documentKey, ragFolders, resolveRagSource } from "./rag-sources";
import { recordVersion } from "./assistant-run-store";

export type PlanRef = { key: string; version: string };
type Plan = PlanRef & { name: string; location: string; objectKey: string; format: "image" | "pdf" };

export function planMember(actor: MemberRecord) {
  return actor.status === "approved" && actor.projectMembershipVerified && !actor.anonymousLink && !actor.accessLinkId;
}

async function plans(actor: MemberRecord, kind: "document" | "aesthetic", id?: string): Promise<Plan[]> {
  if (!planMember(actor) || (actor.role !== "admin" && !actor.permissions[kind === "document" ? "documents" : "aesthetics"])) return [];
  const collection = firestore.collection(kind === "document" ? DOCUMENTS : AESTHETIC_IMAGES);
  const records = id ? collection.doc(id).get().then(doc => [doc]) : collection.where("projectId", "==", actor.projectId).get().then(result => result.docs);
  if (kind === "document") {
    const [docs, folders] = await Promise.all([records, listProjectFolders(actor.projectId)]);
    const state = ragFolders(folders);
    return docs.flatMap(doc => {
      const source = resolveRagSource(actor.projectId, documentKey(doc.id), doc.data(), state);
      if (!source || source.section !== "documents" || (source.format !== "image" && source.format !== "pdf") || !canReadRagSource(actor, source, state)) return [];
      const names = [];
      let folderId = source.folderId;
      while (folderId) {
        const folder = folders.find(item => item.id === folderId);
        if (!folder || names.length >= folders.length) return [];
        names.unshift(folder.name);
        folderId = folder.parentId;
      }
      return [{ key: `document:${doc.id}`, version: recordVersion(doc), name: source.name, location: ["Documents", ...names].join(" / "), objectKey: source.objectKey, format: source.format }];
    });
  }
  const [docs, folders] = await Promise.all([records, firestore.collection(AESTHETIC_FOLDERS).where("projectId", "==", actor.projectId).get()]);
  const byId = new Map(folders.docs.map(doc => [doc.id, doc.data()]));
  return docs.flatMap(doc => {
    const data = doc.data();
    if (!data || data.projectId !== actor.projectId || data.deletedAt || data.encrypted || data.contentType !== "application/pdf" ||
      typeof data.objectKey !== "string" || !data.objectKey.startsWith(`${projectStoragePrefix(actor.projectId)}/aesthetics/plans/`)) return [];
    const names = [];
    let folderId = data.folderId;
    if (!folderId) return [];
    while (folderId) {
      const folder = byId.get(folderId);
      if (!folder || folder.deletedAt || folder.encrypted || aestheticFolderKind(folder.kind, folder.name) !== "plans" || names.length >= byId.size) return [];
      names.unshift(String(folder.name || "Planos"));
      folderId = folder.parentId;
    }
    return [{ key: `aesthetic:${doc.id}`, version: recordVersion(doc), name: String(data.fileName || "Plan"), location: ["Estética", ...names].join(" / "), objectKey: data.objectKey, format: "pdf" }];
  });
}

export async function listImagePlans(actor: MemberRecord) {
  return (await Promise.all([plans(actor, "document"), plans(actor, "aesthetic")])).flat()
    .sort((a, b) => a.location.localeCompare(b.location) || a.name.localeCompare(b.name));
}

export async function resolveImagePlan(actor: MemberRecord, key: string, version?: string) {
  const match = /^(document|aesthetic):([\w-]{1,160})$/.exec(key);
  if (!match) return null;
  const [plan] = await plans(actor, match[1] as "document" | "aesthetic", match[2]);
  return plan && (!version || plan.version === version) ? plan : null;
}

export async function canReadGeneratedAesthetic(actor: MemberRecord, source: unknown) {
  if (!source || typeof source !== "object" || !("key" in source) || !("version" in source) ||
    typeof source.key !== "string" || typeof source.version !== "string" || !source.version) return false;
  return Boolean(await resolveImagePlan(actor, source.key, source.version));
}

export async function visibleGeneratedAesthetics<T>(actor: MemberRecord, records: T[], read: (record: T) => FirebaseFirestore.DocumentData | undefined) {
  const permissions = new Map<string, Promise<boolean>>();
  const allowed = await Promise.all(records.map(record => {
    const source = read(record)?.assistantPlanSource;
    if (source === undefined) return true;
    const key = JSON.stringify(source);
    let pending = permissions.get(key);
    if (!pending) {
      pending = canReadGeneratedAesthetic(actor, source);
      permissions.set(key, pending);
    }
    return pending;
  }));
  return records.filter((_, index) => allowed[index]);
}
