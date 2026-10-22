import { beforeEach, expect, it, vi } from "vitest";
import type { MemberRecord } from "@/lib/project";
import { DEFAULT_MEMBER_PERMISSIONS } from "@/lib/project";
import type { HouseModel } from "@/lib/house-distribution";

const mock = vi.hoisted(() => ({ data: new Map<string, unknown>(), activity: vi.fn(), folderMap: new Map([["plans", "plans"]]), folders: [] as { id: string; parentId: string | null; encrypted?: boolean }[] }));
vi.mock("@/lib/firebase-admin", () => {
  const snapshot = (path: string) => ({ exists: mock.data.has(path), data: () => structuredClone(mock.data.get(path)), id: path.split("/").pop() });
  type Ref = { path: string; collection: (name: string) => Ref; doc: (id: string) => Ref; get: () => Promise<ReturnType<typeof snapshot>> };
  const reference = (path: string): Ref => ({ path, collection: (name: string) => reference(`${path}/${name}`), doc: (id: string) => reference(`${path}/${id}`), get: async () => snapshot(path) });
  return { firestore: { collection: (name: string) => reference(name), getAll: async (...refs: { path: string }[]) => refs.map(r => snapshot(r.path)), runTransaction: async (fn: (tx: unknown) => Promise<unknown>) => { const writes: [string, unknown][] = []; const result = await fn({ get: async (ref: { path: string }) => snapshot(ref.path), getAll: async (...refs: { path: string }[]) => refs.map(r => snapshot(r.path)), set: (ref: { path: string }, value: unknown) => writes.push([ref.path, structuredClone(value)]) }); writes.forEach(([path, value]) => mock.data.set(path, value)); return result; } } };
});
vi.mock("@/lib/auth", () => ({ canAccessFolder: (actor: MemberRecord, _folder: string, top: string) => actor.role === "admin" || actor.folderAccess.mode === "all" || actor.folderAccess.folderIds.includes(top) }));
vi.mock("@/lib/folders", () => ({ listProjectFolders: async () => mock.folders, buildTopLevelFolderMap: () => mock.folderMap, folderTopLevelId: (id: string) => mock.folderMap.get(id) || null }));
vi.mock("@/lib/activity", () => ({ appendActivity: mock.activity }));
import { createDistributionRequest, updateDistributionRequest, importDistribution, correctDistribution, readDistribution } from "@/lib/house-distribution-store";
const actor: MemberRecord = { uid: "owner", projectId: "p1", projectName: "House", isPersonal: false, email: "owner@test.local", name: "Owner", role: "admin", status: "approved", permissions: { ...DEFAULT_MEMBER_PERMISSIONS, distribution: true }, folderAccess: { mode: "all", folderIds: [], allowUnfiled: true } };
const source = { documentId: "plan", page: 4, sheet: "L-2" };
const model: HouseModel = { schemaVersion: 1, revision: 1, name: "Test", notes: "", sourceDocumentIds: ["plan"], rooms: [{ id: "room", name: "Room", polygon: [[0,0],[3,0],[3,4],[0,4]], color: "#abcdef", source, height: { value: null, status: "unconfirmed", note: "", source }, finishes: "", notes: "", coverage: { outlet: "unconfirmed", light: "unconfirmed", switch: "unconfirmed", ac: "unconfirmed" } }], walls: [], openings: [], fixtures: [] };
beforeEach(() => { mock.data.clear(); mock.activity.mockReset(); mock.folders = []; mock.folderMap = new Map([["plans", "plans"]]); mock.data.set("housePlannerDocuments/plan", { projectId: "p1", contentType: "application/pdf", folderId: "plans" }); });
it.each(["document", "ancestor"])("rejects encrypted %s sources for requests and imports even for admins", async (protection) => {
  if (protection === "document") mock.data.set("housePlannerDocuments/plan", { projectId: "p1", contentType: "application/pdf", folderId: "plans", encrypted: true });
  else { mock.folders = [{ id: "vault", parentId: null, encrypted: true }, { id: "plans", parentId: "vault" }]; mock.folderMap.set("plans", "vault"); }
  await expect(createDistributionRequest(actor, ["plan"], "")).rejects.toThrow("Encrypted documents");
  await expect(importDistribution(actor, model, 0)).rejects.toThrow("Encrypted documents");
  expect(await readDistribution(actor)).toBeNull();
  expect(mock.activity).not.toHaveBeenCalled();
});
it("deduplicates requests and cannot mark ready through a status update", async () => {
  const request = await createDistributionRequest(actor, ["plan"], "Please prepare");
  expect((await createDistributionRequest(actor, ["plan"], "Again"))).toEqual(request);
  expect(mock.activity).toHaveBeenCalledTimes(1);
  expect((await updateDistributionRequest(actor, 1, "Tracing rooms")).status).toBe("in_preparation");
  expect(await readDistribution(actor)).toBeNull();
});
it("activates only on successful import and serializes geometry without nested Firestore arrays", async () => {
  await expect(importDistribution(actor, { ...model, sourceDocumentIds: ["missing"] }, 0)).rejects.toThrow();
  expect(await readDistribution(actor)).toBeNull();
  await importDistribution(actor, model, 0);
  expect((mock.data.get("housePlannerProjects/p1/distribution/request") as { status: string }).status).toBe("ready");
  expect((mock.data.get("housePlannerProjects/p1/distribution/current") as { modelJson: string }).modelJson).toBeTypeOf("string");
  expect((await readDistribution(actor))?.model).toEqual(model);
});
it("enforces project, role, section and current source-folder permissions", async () => {
  await importDistribution(actor, model, 0);
  expect(await readDistribution({ ...actor, projectId: "p2" })).toBeNull();
  await expect(importDistribution({ ...actor, projectId: "p2" }, model, 0)).rejects.toThrow("access denied");
  const editor = { ...actor, role: "editor" as const, folderAccess: { mode: "selected" as const, folderIds: [], allowUnfiled: false } };
  await expect(readDistribution(editor)).rejects.toThrow("access denied");
  await expect(readDistribution({ ...actor, role: "viewer", permissions: { ...actor.permissions, distribution: false } })).rejects.toThrow("access required");
  await expect(createDistributionRequest({ ...actor, role: "editor" }, ["plan"], "")).rejects.toThrow("Owner");
  await expect(correctDistribution({ ...actor, role: "viewer" }, {})).rejects.toThrow("editor");
  mock.data.set("housePlannerDocuments/plan", { projectId: "p1", deletedAt: "today", contentType: "application/pdf" });
  await expect(readDistribution(actor)).rejects.toThrow("unavailable");
});
it("rejects stale edits/imports and preserves corrections across model revisions", async () => {
  await importDistribution(actor, model, 0);
  const record = await correctDistribution(actor, { kind: "room", id: "room", revision: 1, correction: { name: "Kitchen" } });
  expect(record.model.rooms[0].name).toBe("Room"); expect(record.roomCorrections.room.name).toBe("Kitchen");
  await expect(correctDistribution(actor, { kind: "room", id: "room", revision: 1, correction: { name: "Stale" } })).rejects.toThrow("changed");
  await expect(importDistribution(actor, model, 1)).rejects.toThrow("changed");
  expect((await importDistribution(actor, { ...model, revision: 2 }, 2)).roomCorrections.room.name).toBe("Kitchen");
});
it("does not publish a model when activity persistence fails", async () => {
  mock.activity.mockRejectedValueOnce(new Error("activity storage down"));
  await expect(importDistribution(actor, model, 0)).rejects.toThrow("activity storage down");
  expect(await readDistribution(actor)).toBeNull();
});
