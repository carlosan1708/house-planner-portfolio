import { describe, expect, it } from "vitest";
import { childFolders, documentsInFolder } from "@/lib/document-navigation";
import { folderDescendantIds, validateFolderMove } from "@/lib/folder-moves";
import { canCommitWorkbookVersion, canPromoteDraft, nextDraftRevision } from "@/lib/drafts";
import { normalizePermissions } from "@/lib/project";

describe("permissions and document navigation", () => {
  it("keeps Expenses disabled for existing non-owner permission records", () => { expect(normalizePermissions({ budget: true }).expenses).toBe(false); expect(normalizePermissions({ expenses: true }).expenses).toBe(true); });
  it("keeps 3D distribution opt-in for non-owner permission records", () => { expect(normalizePermissions({ documents: true }).distribution).toBe(false); expect(normalizePermissions({ documents: true, distribution: true }).distribution).toBe(true); });
  it("keeps project notes private until access is granted", () => { expect(normalizePermissions({ documents: true }).notes).toBe(false); expect(normalizePermissions({ notes: true }).notes).toBe(true); });
  it("inherits quote access from Documents for existing members", () => { expect(normalizePermissions({ documents: true }).quotes).toBe(true); expect(normalizePermissions({ documents: false }).quotes).toBe(false); expect(normalizePermissions({ documents: false, quotes: true }).quotes).toBe(true); });
  it("keeps legacy Activity visible but respects an explicit hidden choice", () => { expect(normalizePermissions({ overview: true }).activity).toBe(true); expect(normalizePermissions({ activity: false }).activity).toBe(false); });
  it("inherits legacy Documents access for Aesthetics but respects an explicit choice", () => { expect(normalizePermissions({ documents: true }).aesthetics).toBe(true); expect(normalizePermissions({ documents: false }).aesthetics).toBe(false); expect(normalizePermissions({ documents: false, aesthetics: true }).aesthetics).toBe(true); });
  it("never creates an aggregate document view", () => { const documents = [{ name: "root.pdf", folderId: null }, { name: "nested.pdf", folderId: "child" }, { name: "deep.pdf", folderId: "deep" }]; expect(documentsInFolder(documents, "root").map((item) => item.name)).toEqual(["root.pdf"]); expect(documentsInFolder(documents, "child").map((item) => item.name)).toEqual(["nested.pdf"]); expect(documentsInFolder(documents, "child", "deep")).toEqual([]); });
  it("searches the saved assistant description as well as the filename", () => { const documents = [{ name: "archivo-001.pdf", description: "Contrato de cocina con garantía", folderId: null }]; expect(documentsInFolder(documents, "root", "garantía")).toHaveLength(1); });
  it("shows only immediate child folders", () => { const folders = [{ id: "a", parentId: null }, { id: "b", parentId: "a" }, { id: "c", parentId: "b" }]; expect(childFolders(folders, "root").map((item) => item.id)).toEqual(["a"]); expect(childFolders(folders, "a").map((item) => item.id)).toEqual(["b"]); });
});

describe("folder moves", () => {
  const folders = [
    { id: "plans", name: "Plans", parentId: null },
    { id: "quotes", name: "Quotes", parentId: null },
    { id: "architect", name: "Architect", parentId: "plans" },
    { id: "drafts", name: "Drafts", parentId: "architect" },
  ];

  it("moves a subfolder to another accessible branch", () => {
    expect(validateFolderMove(folders, "architect", "quotes")).toEqual({ ok: true });
  });

  it("allows only an owner to move a top-level folder", () => {
    expect(validateFolderMove(folders, "plans", "quotes")).toEqual({
      ok: false,
      reason: "top_level_forbidden",
    });
    expect(
      validateFolderMove(folders, "plans", "quotes", {
        allowTopLevelSource: true,
      }),
    ).toEqual({ ok: true });
  });

  it("blocks self, descendant, unchanged and duplicate destinations", () => {
    expect(validateFolderMove(folders, "architect", "architect")).toEqual({ ok: false, reason: "self" });
    expect(validateFolderMove(folders, "architect", "drafts")).toEqual({ ok: false, reason: "descendant" });
    expect(validateFolderMove(folders, "architect", "plans")).toEqual({ ok: false, reason: "same_parent" });
    expect(
      validateFolderMove(
        [...folders, { id: "architect-copy", name: "Architect", parentId: "quotes" }],
        "architect",
        "quotes",
      ),
    ).toEqual({ ok: false, reason: "duplicate" });
    expect([...folderDescendantIds(folders, "architect")]).toEqual(["architect", "drafts"]);
  });
});

describe("draft concurrency", () => {
  it("increments one matching revision and rejects stale saves", () => { expect(nextDraftRevision(3, 3, "editing")).toEqual({ ok: true, revision: 4 }); expect(nextDraftRevision(4, 3, "editing")).toEqual({ ok: false, reason: "revision_conflict" }); expect(nextDraftRevision(3, 3, "submitted")).toEqual({ ok: false, reason: "frozen" }); });
  it("rejects promotion when the plan base is stale", () => { expect(canPromoteDraft(4, 4)).toBe(true); expect(canPromoteDraft(4, 5)).toBe(false); });
  it("rejects direct publishing if either plan or actual spending changed during promotion", () => { expect(canCommitWorkbookVersion(4, 4, 7, 7)).toBe(true); expect(canCommitWorkbookVersion(4, 5, 7, 7)).toBe(false); expect(canCommitWorkbookVersion(4, 4, 7, 8)).toBe(false); });
});
