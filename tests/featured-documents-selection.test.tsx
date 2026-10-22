// @vitest-environment jsdom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import FeaturedDocumentsSelection, { useFeaturedDocumentsSelection, type FeaturedDocumentCandidate } from "@/app/components/FeaturedDocumentsSelection";

type ApiFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
let root: Root, host: HTMLDivElement, fetchMock: ReturnType<typeof vi.fn<ApiFetch>>;
let oldShow: PropertyDescriptor | undefined, oldClose: PropertyDescriptor | undefined;
const documents: FeaturedDocumentCandidate[] = [
  { id: "doc1", name: "Alpha.pdf", description: "Foundation evidence", folderId: null },
  { id: "doc2", name: "Béta privada.pdf", description: "Concrete reinforcement", folderId: "child" },
  { id: "doc3", name: "Gamma.docx", description: "Other reference", folderId: "other" },
];
const folders = [{ id: "plans", name: "Plans", parentId: null }, { id: "child", name: "Structural", parentId: "plans" }, { id: "other", name: "Reports", parentId: null }];
type HarnessProps = { mode?: "demo" | "real"; projectId?: string; enabled?: boolean; canManage?: boolean; language?: "en" | "es"; documents?: FeaturedDocumentCandidate[]; initialDemoIds?: string[] };
function Harness({ mode = "real", projectId = "project-a", enabled = true, canManage = true, language = "en", documents: candidates = documents, initialDemoIds = [] }: HarnessProps) {
  const [demoIds, setDemoIds] = useState(initialDemoIds);
  const selection = useFeaturedDocumentsSelection({ mode, projectId, enabled, demoIds, onDemoChange: setDemoIds });
  return createElement("section", null,
    createElement("output", { "data-testid": "selection" }, JSON.stringify({ ids: selection.documentIds, loading: selection.loading, saving: selection.saving, error: selection.error })),
    createElement(FeaturedDocumentsSelection, { language, documents: candidates, folders, canManage, busy: false, selection }),
  );
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  fetchMock = vi.fn<ApiFetch>(async () => Response.json({ documentIds: ["doc1"] }));
  vi.stubGlobal("fetch", fetchMock);
  oldShow = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal");
  oldClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "close");
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: function(this: HTMLDialogElement) { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value: function(this: HTMLDialogElement) { this.open = false; } });
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  if (oldShow) Object.defineProperty(HTMLDialogElement.prototype, "showModal", oldShow); else Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
  if (oldClose) Object.defineProperty(HTMLDialogElement.prototype, "close", oldClose); else Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
  host.remove(); document.body.style.overflow = ""; vi.unstubAllGlobals();
});
async function settle() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); }); }
async function render(props: HarnessProps = {}) { await act(async () => { root.render(createElement(Harness, props)); }); await settle(); }
function state(): { ids: string[]; loading: boolean; saving: boolean; error: string | null } { return JSON.parse(host.querySelector("output")!.textContent!); }
function button(text: string) {
  const result = [...host.querySelectorAll<HTMLButtonElement>("button")].find(item => item.textContent?.includes(text));
  expect(result, `Missing button ${text}`).toBeDefined(); return result!;
}
async function click(text: string) { await act(async () => { button(text).click(); }); await settle(); }
function checkbox(name: string) {
  const label = [...host.querySelectorAll<HTMLLabelElement>("label")].find(item => item.querySelector("strong")?.textContent === name);
  expect(label, `Missing candidate ${name}`).toBeDefined(); return label!.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
}
async function toggle(name: string) { await act(async () => { checkbox(name).click(); }); await settle(); }
async function search(value: string) {
  await act(async () => { const input = host.querySelector<HTMLInputElement>('input[type="search"]')!; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); }); await settle();
}
async function chooseFolder(label: string) {
  await act(async () => { const select = host.querySelector<HTMLSelectElement>("dialog select")!; const option = [...select.options].find(item => item.textContent === label)!; select.value = option.value; select.dispatchEvent(new Event("change", { bubbles: true })); }); await settle();
}
const patches = () => fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH");
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }

describe("featured document selection", () => {
  it("loads no-store, searches complete folder paths and sends only the represented opening delta", async () => {
    const before = JSON.stringify(documents);
    fetchMock.mockImplementation(async (_input, init) => Response.json({ documentIds: init?.method === "PATCH" ? ["unrepresented", "doc2"] : ["doc1", "unrepresented"] }));
    await render();
    expect(fetchMock.mock.calls[0][1]?.cache).toBe("no-store");
    await click("Choose documents");
    expect(checkbox("Alpha.pdf").checked).toBe(true);
    await toggle("Alpha.pdf");
    await search("plans / structural");
    expect(host.querySelector(".featured-documents-candidates")?.textContent).toContain("Béta privada.pdf");
    expect(host.querySelector(".featured-documents-candidates")?.textContent).not.toContain("Alpha.pdf");
    await toggle("Béta privada.pdf"); await search("");
    await chooseFolder("Unfiled"); expect(checkbox("Alpha.pdf").checked).toBe(false);
    await chooseFolder("All folders"); expect(checkbox("Béta privada.pdf").checked).toBe(true);
    await click("Save selection");
    expect(JSON.parse(String(patches()[0][1]?.body))).toEqual({ addIds: ["doc2"], removeIds: ["doc1"] });
    expect(state().ids).toEqual(["unrepresented", "doc2"]);
    expect(host.querySelector("dialog")).toBeNull();
    expect(JSON.stringify(documents)).toBe(before);
  });

  it.each(["Cancel", "Escape", "backdrop"])("%s discards the draft without a PATCH and restores focus and scrolling", async method => {
    document.body.style.overflow = "auto";
    await render(); const opener = button("Choose documents"); opener.focus();
    await click("Choose documents"); await toggle("Béta privada.pdf");
    expect(document.body.style.overflow).toBe("hidden");
    if (method === "Cancel") await click("Cancel");
    else await act(async () => { const dialog = host.querySelector("dialog")!; if (method === "Escape") dialog.dispatchEvent(new Event("cancel", { bubbles: true, cancelable: true })); else dialog.click(); });
    await settle();
    expect(host.querySelector("dialog")).toBeNull(); expect(state().ids).toEqual(["doc1"]);
    expect(patches()).toHaveLength(0); expect(document.activeElement).toBe(opener); expect(document.body.style.overflow).toBe("auto");
    await click("Choose documents"); expect(checkbox("Béta privada.pdf").checked).toBe(false);
  });

  it("rejects malformed successful reads and requires a successful retry before curation", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ documentIds: ["invalid/path"] }));
    await render(); expect(state().error).toBe("load"); expect(button("Choose documents").disabled).toBe(true);
    await click("Choose documents"); expect(host.querySelector("dialog")).toBeNull(); expect(patches()).toHaveLength(0);
    await click("Retry"); expect(state().error).toBeNull(); expect(state().ids).toEqual(["doc1"]);
    await click("Choose documents"); expect(checkbox("Alpha.pdf").checked).toBe(true);
  });

  it("retains failed-save drafts and old IDs through locale and folder-filter changes, then retries the same delta", async () => {
    let failed = false;
    fetchMock.mockImplementation(async (_input, init) => {
      if (init?.method !== "PATCH") return Response.json({ documentIds: ["doc1", "unrepresented"] });
      if (!failed) { failed = true; return Response.json({ error: "Storage failure" }, { status: 500 }); }
      return Response.json({ documentIds: ["unrepresented", "doc2"] });
    });
    await render(); await click("Choose documents"); await toggle("Alpha.pdf"); await toggle("Béta privada.pdf");
    await click("Save selection"); expect(state().ids).toEqual(["doc1", "unrepresented"]); expect(state().error).toBe("save");
    await render({ language: "es" });
    expect(host.querySelector("dialog")?.open).toBe(true); expect(checkbox("Béta privada.pdf").checked).toBe(true); expect(checkbox("Alpha.pdf").checked).toBe(false);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("borrador se conservan");
    await chooseFolder("Plans / Structural"); expect(checkbox("Béta privada.pdf").checked).toBe(true);
    await click("Guardar selección"); expect(state().ids).toEqual(["unrepresented", "doc2"]); expect(state().error).toBeNull();
    expect(patches()).toHaveLength(2); expect(patches()[0][1]?.body).toBe(patches()[1][1]?.body);
  });

  it("explains the server-wide limit without exposing hidden selections or losing its draft", async () => {
    fetchMock.mockImplementation(async (_input, init) => init?.method === "PATCH" ? Response.json({ error: "Limit reached" }, { status: 409 }) : Response.json({ documentIds: ["doc1"] }));
    await render(); await click("Choose documents"); await toggle("Béta privada.pdf"); await click("Save selection");
    expect(state().ids).toEqual(["doc1"]); expect(state().error).toBe("limit"); expect(checkbox("Béta privada.pdf").checked).toBe(true);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("up to 30 documents");
  });

  it("bounds visible checked candidates to 30 while leaving selected checkboxes removable", async () => {
    const many = Array.from({ length: 31 }, (_, index) => ({ id: `document-${index}`, name: `Document ${index}.pdf`, folderId: null }));
    await render({ mode: "demo", initialDemoIds: many.slice(0, 30).map(item => item.id), documents: many });
    await click("Choose documents"); expect(checkbox("Document 30.pdf").disabled).toBe(true);
    await toggle("Document 0.pdf"); expect(checkbox("Document 30.pdf").disabled).toBe(false);
    await toggle("Document 30.pdf"); await click("Save selection"); expect(state().ids).toHaveLength(30);
    expect(state().ids.at(-1)).toBe("document-30"); expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps demo saves local and its open draft stable through EN/ES switching", async () => {
    await render({ mode: "demo", initialDemoIds: ["doc1"] }); await click("Choose documents"); await toggle("Béta privada.pdf");
    await render({ mode: "demo", language: "es" }); expect(checkbox("Béta privada.pdf").checked).toBe(true);
    await click("Guardar selección"); expect(state().ids).toEqual(["doc1", "doc2"]);
    await render({ mode: "demo", language: "en" }); await click("Choose documents"); expect(checkbox("Béta privada.pdf").checked).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not fetch disabled selections, hides curation from viewers and closes it after permission loss", async () => {
    await render({ enabled: false, canManage: false }); expect(fetchMock).not.toHaveBeenCalled(); expect(host.querySelector("button")).toBeNull();
    await render({ canManage: false }); expect(state().ids).toEqual(["doc1"]); expect(buttonExists("Choose documents")).toBe(false);
    await render(); await click("Choose documents"); await toggle("Béta privada.pdf");
    await render({ canManage: false }); expect(host.querySelector("dialog")).toBeNull(); expect(patches()).toHaveLength(0);
  });

  it("aborts and discards a previous project's late GET response", async () => {
    const first = deferred<Response>();
    fetchMock.mockImplementationOnce(() => first.promise).mockResolvedValue(Response.json({ documentIds: ["doc2"] }));
    await render({ projectId: "a" }); expect(state().loading).toBe(true);
    await render({ projectId: "b" }); expect(state().ids).toEqual(["doc2"]);
    await act(async () => first.resolve(Response.json({ documentIds: ["doc1"] }))); await settle();
    expect(state().ids).toEqual(["doc2"]); expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });

  it("cannot commit a late PATCH response into a different project", async () => {
    const pending = deferred<Response>(); let reads = 0;
    fetchMock.mockImplementation(async (_input, init) => init?.method === "PATCH" ? pending.promise : Response.json({ documentIds: ++reads === 1 ? ["doc1"] : ["doc3"] }));
    await render({ projectId: "a" }); await click("Choose documents"); await toggle("Béta privada.pdf");
    await act(async () => { button("Save selection").click(); });
    expect(state().saving).toBe(true);
    await render({ projectId: "b", canManage: false }); expect(state().ids).toEqual(["doc3"]);
    await act(async () => pending.resolve(Response.json({ documentIds: ["doc1", "doc2"] }))); await settle();
    expect(state().ids).toEqual(["doc3"]); expect(state().saving).toBe(false); expect(patches()[0][1]?.signal?.aborted).toBe(true);
  });
});
function buttonExists(text: string) { return [...host.querySelectorAll("button")].some(item => item.textContent?.includes(text)); }
