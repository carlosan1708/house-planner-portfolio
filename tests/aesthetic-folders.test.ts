import { beforeEach, describe, expect, it, vi } from "vitest";

type Data = Record<string, unknown>;
const state = vi.hoisted(() => ({ records: new Map<string, Record<string, unknown>>(), writes: [] as Array<{ id: string; data: Record<string, unknown> }> }));
vi.mock("firebase-admin/firestore", () => ({ FieldValue: { serverTimestamp: () => "timestamp", delete: () => "deleted-field" } }));
vi.mock("@/lib/firebase-admin", () => ({ firestore: {
  collection: () => ({ where: (_field: string, _operator: string, projectId: string) => ({ projectId }), doc: (id: string) => ({ id }) }),
  runTransaction: async (work: (transaction: unknown) => Promise<void>) => work({
    get: async ({ projectId }: { projectId: string }) => ({ docs: [...state.records].filter(([, data]) => data.projectId === projectId).map(([id, data]) => ({ ref: { id }, data: () => data })) }),
    set: (ref: { id: string }, data: Data) => { state.writes.push({ id: ref.id, data }); },
  }),
} }));

import { ensureDefaultAestheticFolders } from "@/lib/aesthetic-folders";
import { projectScopedId } from "@/lib/project";

beforeEach(() => { state.records.clear(); state.writes.length = 0; });

describe("default Aesthetics root folders", () => {
  it("creates the three default roots for an empty project", async () => {
    await ensureDefaultAestheticFolders("project-one", "owner@example.test");
    expect(state.writes.map(({ data }) => [data.name, data.kind, data.parentId])).toEqual([
      ["Interior", "images", null], ["Exterior", "images", null], ["Planos", "plans", null],
    ]);
  });

  it("does not recreate an existing root when PDF child folders also exist", async () => {
    state.records.set("plans-root", { projectId: "project-one", name: "Planos", kind: "plans" });
    state.records.set("plans-child", { projectId: "project-one", name: "Revisiones", kind: "plans", parentId: "plans-root" });
    await ensureDefaultAestheticFolders("project-one", "owner@example.test");
    expect(state.writes).toEqual([]);
  });

  it("restores the missing Planos root even when a PDF child survives", async () => {
    const rootId = projectScopedId("project-one", "aesthetic-plans");
    state.records.set(rootId, { projectId: "project-one", name: "Planos", kind: "plans", deletedAt: "timestamp" });
    state.records.set("plans-child", { projectId: "project-one", name: "Revisiones", kind: "plans", parentId: rootId });
    await ensureDefaultAestheticFolders("project-one", "owner@example.test");
    expect(state.writes).toEqual([{ id: rootId, data: expect.objectContaining({ projectId: "project-one", name: "Planos", kind: "plans", parentId: null, deletedAt: "deleted-field" }) }]);
    expect(state.records.get("plans-child")?.parentId).toBe(rootId);
  });

  it("upgrades a legacy root named Planos without changing its curated selection", async () => {
    state.records.set("legacy-root", { projectId: "project-one", name: "Planos", carouselImageIds: ["plan-first"] });
    await ensureDefaultAestheticFolders("project-one", "owner@example.test");
    expect(state.writes).toEqual([{ id: "legacy-root", data: { kind: "plans", updatedAt: "timestamp" } }]);
  });

  it("does not treat an image folder named Planos or another project's root as the protected PDF root", async () => {
    state.records.set("image-folder", { projectId: "project-one", name: "Planos", kind: "images" });
    state.records.set("foreign-root", { projectId: "project-other", name: "Planos", kind: "plans" });
    await ensureDefaultAestheticFolders("project-one", "owner@example.test");
    expect(state.writes).toEqual([{ id: projectScopedId("project-one", "aesthetic-plans"), data: expect.objectContaining({ projectId: "project-one", parentId: null, kind: "plans" }) }]);
  });
});
