import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MemberRecord } from "@/lib/project";

const mock = vi.hoisted(() => ({
  actor: vi.fn(),
  usage: vi.fn(),
  records: new Map<string, Record<string, unknown>>(),
  nextId: 1,
}));

vi.mock("firebase-admin/firestore", () => ({ FieldValue: { serverTimestamp: () => ({ toDate: () => new Date("2026-09-19T00:00:00.000Z") }) } }));
vi.mock("@/lib/auth", () => ({ requireTabAccess: mock.actor }));
vi.mock("@/lib/usage-store", () => ({ recordUsageAction: mock.usage }));
vi.mock("@/lib/firebase-admin", () => {
  const doc = (id = `note-${mock.nextId++}`) => ({
    id,
    get: async () => ({ id, exists: mock.records.has(id), data: () => mock.records.get(id) }),
    set: async (data: Record<string, unknown>) => { mock.records.set(id, data); },
  });
  return { firestore: {
    collection: () => ({
      doc,
      where: (_field: string, _operator: string, projectId: string) => ({ get: async () => ({ docs: [...mock.records.entries()]
        .filter(([, data]) => data.projectId === projectId)
        .map(([id, data]) => ({ id, data: () => data })) }) }),
    }),
    runTransaction: async (callback: (transaction: { get: (ref: ReturnType<typeof doc>) => ReturnType<ReturnType<typeof doc>["get"]>; update: (ref: ReturnType<typeof doc>, data: Record<string, unknown>) => void; delete: (ref: ReturnType<typeof doc>) => void }) => Promise<void>) => callback({
      get: (ref) => ref.get(),
      update: (ref, data) => { mock.records.set(ref.id, { ...mock.records.get(ref.id), ...data }); },
      delete: (ref) => { mock.records.delete(ref.id); },
    }),
  } };
});

import { DELETE, GET, PATCH, POST } from "@/app/api/notes/route";
import { noteCitationsRemainEnabled, rankAssistantNotes, searchAssistantNotes } from "@/lib/project-notes";

const member: MemberRecord = {
  uid: "u1", projectId: "sample-house", projectName: "Sample", isPersonal: false,
  email: "owner@example.com", name: "Owner", role: "admin", status: "approved",
  permissions: { overview: true, activity: true, budget: true, quotes: true, expenses: true, documents: true, notes: false, aesthetics: true, distribution: false, approvals: true, plan: true, decisions: true, site: true },
  folderAccess: { mode: "all", folderIds: [], allowUnfiled: true },
};

const request = (method: string, data: unknown) => new Request("http://localhost/api/notes", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });

beforeEach(() => {
  mock.records.clear(); mock.nextId = 1; mock.actor.mockReset(); mock.actor.mockResolvedValue(member);
  mock.usage.mockReset(); mock.usage.mockResolvedValue(undefined);
});

describe("project notes", () => {
  it("counts completed note changes without private text and skips unchanged saves", async () => {
    const response = await POST(request("POST", { title: "Private title", content: "Private content" }));
    const { note } = await response.json();
    expect(mock.usage).toHaveBeenCalledExactlyOnceWith(member, "record.create", "notes", note.id);
    mock.usage.mockClear();
    await PATCH(request("PATCH", { id: note.id, title: note.title, content: note.content, aiEnabled: false }));
    expect(mock.usage).not.toHaveBeenCalled();
    await PATCH(request("PATCH", { id: note.id, title: note.title, content: "Changed private content", aiEnabled: false }));
    expect(mock.usage).toHaveBeenCalledExactlyOnceWith(member, "record.update", "notes", expect.any(String));
    mock.usage.mockClear();
    await DELETE(new Request(`http://localhost/api/notes?id=${note.id}`, { method: "DELETE" }));
    expect(mock.usage).toHaveBeenCalledExactlyOnceWith(member, "record.delete", "notes", note.id);
  });

  it("does not fail a completed note when analytics is unavailable", async () => {
    mock.usage.mockRejectedValueOnce(new Error("analytics unavailable"));
    expect((await POST(request("POST", { title: "Note", content: "Text" }))).status).toBe(201);
    expect(mock.records.size).toBe(1);
  });

  it("defaults AI access off and excludes the note from assistant retrieval", async () => {
    const response = await POST(request("POST", { title: "  Altura de sala ", content: "La sala mide 3 metros." }));
    expect(response.status).toBe(201);
    const { note } = await response.json();
    expect(note).toMatchObject({ title: "Altura de sala", aiEnabled: false });
    expect(await searchAssistantNotes(member, "altura sala")).toEqual([]);

    const enabled = await PATCH(request("PATCH", { id: note.id, title: note.title, content: note.content, aiEnabled: true }));
    expect(enabled.status).toBe(200);
    expect((await searchAssistantNotes(member, "altura sala"))[0]).toMatchObject({ id: note.id, title: "Altura de sala" });
    expect((await searchAssistantNotes(member, "Qué información hay guardada en las notas del proyecto"))[0]).toMatchObject({ id: note.id });

    await PATCH(request("PATCH", { id: note.id, title: note.title, content: note.content, aiEnabled: false }));
    expect(await searchAssistantNotes(member, "altura sala")).toEqual([]);
  });

  it("keeps notes within the project and enforces the Notes section permission", async () => {
    mock.records.set("other", { projectId: "other-project", title: "Otra casa", content: "Privado", aiEnabled: true });
    mock.records.set("ours", { projectId: member.projectId, title: "Sample", content: "Dato del proyecto", aiEnabled: true });
    const response = await GET();
    const data = await response.json();
    expect(data.notes.map((note: { id: string }) => note.id)).toEqual(["ours"]);
    expect(await searchAssistantNotes({ ...member, role: "editor", permissions: { ...member.permissions, notes: false } }, "Sample")).toEqual([]);

    mock.actor.mockResolvedValue(null);
    expect((await GET()).status).toBe(403);
    expect((await POST(request("POST", { title: "New", content: "Text" }))).status).toBe(403);
  });

  it("cannot edit or delete another project's note", async () => {
    mock.records.set("other", { projectId: "other-project", title: "Otra casa", content: "Privado", aiEnabled: true });
    expect((await PATCH(request("PATCH", { id: "other", title: "Cambio", content: "Dato", aiEnabled: true }))).status).toBe(404);
    expect((await DELETE(new Request("http://localhost/api/notes?id=other", { method: "DELETE" }))).status).toBe(404);
    expect(mock.records.get("other")?.content).toBe("Privado");
  });

  it("drops old note-based replies from new AI context after opt-out", () => {
    const cited = [{ id: "note:enabled", kind: "note" }];
    expect(noteCitationsRemainEnabled(cited, new Set(["note:enabled"]))).toBe(true);
    expect(noteCitationsRemainEnabled(cited, new Set())).toBe(false);
  });

  it("includes relevant text near the end of a long note", () => {
    const note = { id: "long", title: "Datos", content: `${"Introducción. ".repeat(300)}\nLa altura de cocina es 2.8 metros.`, aiEnabled: true, createdBy: "", updatedBy: "", createdAt: null, updatedAt: null };
    expect(rankAssistantNotes([note], "altura cocina")[0].excerpt).toContain("2.8 metros");
  });
});
