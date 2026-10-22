// @vitest-environment jsdom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DocumentSearch, { type SearchableDocument } from "@/app/components/DocumentSearch";

const documents: SearchableDocument[] = [
  { id: "permit", name: "Municipal.pdf", description: "Licencia municipal aprobada", folderId: "legal", downloadUrl: "/permit", previewUrl: "/preview", previewKind: "pdf" },
  { id: "plan", name: "Plano.pdf", description: "Distribución de cocina", folderId: "nested", downloadUrl: "/plan" },
  { id: "private", name: "Secret.pdf", description: "Licencia privada", folderId: "vault-child", downloadUrl: "/secret" },
  { id: "orphan", name: "Orphan.pdf", description: "Licencia huérfana", folderId: "orphan", downloadUrl: "/orphan" },
];
const folders = [
  { id: "legal", name: "Documentos legales", parentId: null }, { id: "plans", name: "Anteproyecto", parentId: null }, { id: "nested", name: "Plantas", parentId: "plans" },
  { id: "vault", name: "Vault", parentId: null, encrypted: true, unlocked: false }, { id: "vault-child", name: "Child", parentId: "vault" }, { id: "orphan", name: "Orphan", parentId: "absent" },
];
let root: Root, host: HTMLDivElement;
const fetchMock = vi.fn<typeof fetch>();
const onPreview = vi.fn(), onOpenFolder = vi.fn();
type HarnessProps = { projectId?: string; mode?: "demo" | "real"; allowSemantic?: boolean; documents?: SearchableDocument[]; folders?: typeof folders };
function Harness({ projectId = "project", mode = "real", allowSemantic = true, documents: records = documents, folders: locations = folders }: HarnessProps) {
  const [query, setQuery] = useState("");
  return createElement(DocumentSearch, { projectId, mode, allowSemantic, documents: records, folders: locations, language: "es", query, onQueryChange: setQuery, onPreview, onOpenFolder });
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); fetchMock.mockReset(); onPreview.mockReset(); onOpenFolder.mockReset();
  fetchMock.mockResolvedValue(Response.json({ mode: "semantic", results: [] })); vi.stubGlobal("fetch", fetchMock);
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
async function settle() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 1)); }); }
async function render(props: HarnessProps = {}) { await act(async () => { root.render(createElement(Harness, props)); }); await settle(); }
async function query(value: string) {
  await act(async () => { const input = host.querySelector("input")!; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); }); await settle();
}
function button(label: string) { const found = [...host.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === label); expect(found, label).toBeDefined(); return found!; }
async function click(label: string) { await act(async () => { button(label).click(); }); await settle(); }
const names = () => [...host.querySelectorAll(".document-search-result-body>.document-search-title,.document-search-result-body>strong")].map(element => element.textContent);
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }

describe("global document search UI", () => {
  it("searches accessible descriptions and complete paths with accents without making AI calls", async () => {
    await render(); await query("licencia municipal"); expect(names()).toEqual(["Municipal.pdf"]);
    await query("distribucion"); expect(names()).toEqual(["Plano.pdf"]);
    await query("Anteproyecto / Plantas"); expect(names()).toEqual(["Plano.pdf"]);
    await query("Licencia"); expect(names()).toEqual(["Municipal.pdf"]); expect(host.textContent).not.toContain("Secret.pdf"); expect(host.textContent).not.toContain("Orphan.pdf");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("finds a related description only after explicit submit and uses current document fields and URLs", async () => {
    fetchMock.mockResolvedValue(Response.json({ mode: "semantic", results: [{ id: "permit", score: 0.9, name: "Invented title", downloadUrl: "https://untrusted.test" }, { id: "forged" }, { id: "private" }, { id: "permit" }] }));
    await render(); await query("permiso para construir"); expect(names()).toEqual([]); await click("Buscar por significado");
    expect(fetchMock).toHaveBeenCalledTimes(1); expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ query: "permiso para construir", language: "es" });
    expect(names()).toEqual(["Municipal.pdf"]); expect(host.textContent).toContain("Por significado"); expect(host.textContent).not.toMatch(/90%|Invented|forged|Secret/); expect(host.innerHTML).not.toContain("untrusted.test");
    await click("Abrir"); expect(onPreview).toHaveBeenCalledWith("permit");
    await click("Documentos legales ↗"); expect(onOpenFolder).toHaveBeenCalledWith("legal");
  });
  it.each(["semantic_unavailable", "search_limit", "semantic_scope_limit", "invalid_query", "denied"])("keeps text results on %s and retries only on request", async code => {
    fetchMock.mockResolvedValue(Response.json({ code }, { status: 503 })); await render(); await query("Municipal"); await click("Buscar por significado");
    expect(names()).toEqual(["Municipal.pdf"]); expect(host.querySelector(".document-search-message")?.textContent).toBeTruthy(); expect(host.textContent).toContain("Por texto"); expect(fetchMock).toHaveBeenCalledTimes(1);
    await settle(); expect(fetchMock).toHaveBeenCalledTimes(1); await click("Buscar por significado"); expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("ignores a late response after query change and supports cancel, Escape, clear and focus", async () => {
    const pending = deferred<Response>(); fetchMock.mockReturnValue(pending.promise); await render(); await query("permiso construir"); await click("Buscar por significado");
    expect(host.querySelector('[aria-busy="true"]')).not.toBeNull(); await query("cocina"); await act(async () => pending.resolve(Response.json({ mode: "semantic", results: [{ id: "permit" }] }))); await settle();
    expect(names()).toEqual(["Plano.pdf"]); expect(host.querySelector(".document-search-match")?.textContent).toBe("Por texto"); expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true);
    const again = deferred<Response>(); fetchMock.mockReturnValue(again.promise); await click("Buscar por significado"); await click("Cancelar"); expect(host.querySelector('[aria-busy="true"]')).toBeNull();
    const input = host.querySelector("input")!; expect(document.activeElement).toBe(input); await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(input.value).toBe(""); expect(document.activeElement).toBe(input);
    await act(async () => again.resolve(Response.json({ mode: "semantic", results: [{ id: "permit" }] }))); await settle(); expect(names()).toEqual([]);
  });
  it.each(["project", "documents", "folders"])("ignores a late semantic response when %s scope changes", async change => {
    const pending = deferred<Response>(); fetchMock.mockReturnValue(pending.promise); await render(); await query("permiso construir"); await click("Buscar por significado");
    await render(change === "project" ? { projectId: "other" } : change === "documents" ? { documents: documents.filter(document => document.id !== "permit") } : { folders: folders.filter(folder => folder.id !== "legal") });
    await act(async () => pending.resolve(Response.json({ mode: "semantic", results: [{ id: "permit" }] }))); await settle(); expect(names()).toEqual([]); expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });
  it.each([{ mode: "demo" as const }, { allowSemantic: false }])("keeps demo and anonymous link search local: %s", async props => {
    await render(props); await query("Municipal"); await click("Buscar por significado"); expect(names()).toEqual(["Municipal.pdf"]); expect(host.querySelector(".document-search-message")).not.toBeNull(); expect(fetchMock).not.toHaveBeenCalled();
  });
  it("requires three characters for semantic search while short text searches remain useful", async () => {
    await render(); await query("p"); expect(names()).toContain("Plano.pdf"); expect(button("Buscar por significado").disabled).toBe(true); expect(host.querySelector("input")?.maxLength).toBe(400); expect(fetchMock).not.toHaveBeenCalled();
  });
});
