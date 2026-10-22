// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import FileShareButton from "@/app/components/FileShareButton";

type Props = Parameters<typeof FileShareButton>[0];
let root: Root, host: HTMLDivElement;
const fetchMock = vi.fn<typeof fetch>();
const props: Props = { kind: "document", id: "doc-one", name: "A very long plan & reference.pdf", projectId: "project-one", language: "en", canShare: true };
const response = (days = 7, token = "private-token") => Response.json({ url: `/api/files/share?token=${token}`, expiresAt: "2026-10-25T18:30:00.000Z", expiresInDays: days });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  fetchMock.mockReset().mockResolvedValue(response());
  vi.stubGlobal("fetch", fetchMock);
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); vi.restoreAllMocks(); document.body.innerHTML = ""; });
async function render(changes: Partial<Props> = {}) { await act(async () => { root.render(createElement(FileShareButton, { ...props, ...changes })); }); }
function button(label: string) { const found = [...document.querySelectorAll<HTMLButtonElement>("button")].find(item => item.textContent === label); expect(found, `Missing button: ${label}`).toBeDefined(); return found!; }
async function click(label: string) { await act(async () => { button(label).click(); }); }
async function choose(days: string) { await act(async () => { const select = document.querySelector("select")!; select.value = days; select.dispatchEvent(new Event("change", { bubbles: true })); }); }
function linkInput() { return document.querySelector<HTMLInputElement>(".file-share-result input"); }

describe("temporary file sharing", () => {
  it("explains unauthenticated access, defaults to seven days and creates only on explicit request", async () => {
    await render(); await click("Share file");
    expect(document.querySelector('[role="dialog"]')?.getAttribute("aria-labelledby")).toBeTruthy();
    expect(document.body.textContent).toContain("Anyone with this link can download this file without signing in until it expires.");
    expect(document.querySelector("select")?.value).toBe("7");
    expect(fetchMock).not.toHaveBeenCalled();
    await click("Create link");
    expect(fetchMock).toHaveBeenCalledWith("/api/files/share", expect.objectContaining({ method: "POST", body: JSON.stringify({ kind: "document", id: "doc-one", expiresInDays: 7 }), signal: expect.any(AbortSignal) }));
    expect(linkInput()?.value).toBe(new URL("/api/files/share?token=private-token", window.location.origin).href);
    expect(document.querySelector("time")?.dateTime).toBe("2026-10-25T18:30:00.000Z");
    expect(document.querySelector("time")?.textContent).toContain("2026");
    expect(document.querySelector(".file-share-modal")?.parentElement).toBe(document.body);
  });

  it.each([1, 3])("clears a previous link before creating a %i-day link", async (days) => {
    await render(); await click("Share file"); await click("Create link");
    await choose(String(days));
    expect(linkInput()).toBeNull();
    fetchMock.mockResolvedValue(response(days));
    await click("Create link");
    expect(JSON.parse(String(fetchMock.mock.lastCall?.[1]?.body))).toEqual({ kind: "document", id: "doc-one", expiresInDays: days });
    expect(linkInput()).not.toBeNull();
  });

  it("copies the generated absolute link", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    await render(); await click("Share file"); await click("Create link"); await click("Copy link");
    expect(writeText).toHaveBeenCalledWith(linkInput()?.value);
    expect(document.querySelector('[role="status"]')?.textContent).toBe("Link copied");
  });

  it("offers a selected manual-copy field when clipboard access fails, in Spanish", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    await render({ language: "es", kind: "aesthetic" }); await click("Compartir archivo"); await click("Crear enlace"); await click("Copiar enlace");
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).kind).toBe("aesthetic");
    expect(document.querySelector('[role="status"]')?.textContent).toContain("manualmente");
    expect(document.activeElement).toBe(linkInput());
    expect(linkInput()?.selectionStart).toBe(0);
    expect(linkInput()?.selectionEnd).toBe(linkInput()?.value.length);
  });

  it("preserves the duration and dialog on failure and permits retry", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ error: "sharing_unavailable" }, { status: 503 }));
    await render(); await click("Share file"); await choose("3"); await click("Create link");
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("Try again");
    expect(document.querySelector("select")?.value).toBe("3");
    fetchMock.mockResolvedValue(response(3)); await click("Create link");
    expect(document.querySelector('[role="alert"]')).toBeNull(); expect(linkInput()).not.toBeNull();
  });

  it("discards a response after the selected duration changes", async () => {
    const pending = deferred<Response>(); fetchMock.mockReturnValueOnce(pending.promise);
    await render(); await click("Share file"); await click("Create link");
    const signal = fetchMock.mock.calls[0][1]?.signal;
    await choose("1");
    expect(signal?.aborted).toBe(true);
    await act(async () => { pending.resolve(response()); });
    expect(linkInput()).toBeNull(); expect(button("Create link").disabled).toBe(false);
  });

  it.each([{ id: "doc-two" }, { projectId: "project-two" }])("discards pending responses after changing context: %j", async (context) => {
    const pending = deferred<Response>(); fetchMock.mockReturnValueOnce(pending.promise);
    await render(); await click("Share file"); await click("Create link");
    const signal = fetchMock.mock.calls[0][1]?.signal;
    await render(context);
    expect(signal?.aborted).toBe(true); expect(document.querySelector('[role="dialog"]')).toBeNull();
    await click("Share file");
    await act(async () => { pending.resolve(response()); });
    expect(linkInput()).toBeNull();
  });

  it("cancels pending generation on Escape and restores the trigger focus", async () => {
    const pending = deferred<Response>(); fetchMock.mockReturnValueOnce(pending.promise);
    await render(); await click("Share file");
    button("Create link").focus();
    await click("Create link");
    const signal = fetchMock.mock.calls[0][1]?.signal;
    expect(button("Creating link…").disabled).toBe(true);
    expect(document.activeElement).toBe(button("Close"));
    expect(button("Close").disabled).toBe(false);
    await act(async () => { document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(signal?.aborted).toBe(true); expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(button("Share file"));
    await act(async () => { pending.resolve(response()); });
    await click("Share file"); expect(linkInput()).toBeNull();
  });

  it("keeps keyboard dismissal available after regenerating a link", async () => {
    await render(); await click("Share file"); await click("Create link");
    await choose("3"); fetchMock.mockResolvedValue(response(3));
    button("Create link").focus(); await click("Create link");
    expect(linkInput()).not.toBeNull();
    expect(document.activeElement).toBe(button("Close"));
    await act(async () => { document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(button("Share file"));
  });

  it.each([{ canShare: false }, { encrypted: true }, { projectId: "" }])("hides sharing when the context is ineligible: %j", async (context) => {
    await render(context); expect(host.querySelector("button")).toBeNull(); expect(fetchMock).not.toHaveBeenCalled();
  });

  it("removes an existing result immediately when sharing permission is removed", async () => {
    await render(); await click("Share file"); await click("Create link");
    await render({ canShare: false });
    expect(document.querySelector('[role="dialog"]')).toBeNull(); expect(host.querySelector("button")).toBeNull();
  });
});
