// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import QuotesWorkspace from "@/app/components/QuotesWorkspace";
import NotesWorkspace from "@/app/components/NotesWorkspace";

vi.mock("@/lib/usage-client", () => ({ trackUsageInteraction: vi.fn() }));

let root: Root;
let container: HTMLDivElement;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false })));
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { value: vi.fn(), configurable: true });
  fetchMock = vi.fn(async () => { throw new Error("Demo must not call an API"); });
  vi.stubGlobal("fetch", fetchMock);
  container = document.createElement("div"); document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); document.body.innerHTML = ""; vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function render(element: ReturnType<typeof createElement>) { await act(async () => { root.render(element); }); }
async function click(text: string, scope: ParentNode = container) {
  const button = [...scope.querySelectorAll("button")].find((item) => item.textContent === text);
  expect(button, `Missing button: ${text}`).toBeDefined();
  await act(async () => { button!.click(); });
}
async function input(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  await act(async () => {
    const prototype = element.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function submit(form: HTMLFormElement) { await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); }); }

describe("interactive demo quote reviews", () => {
  it("shows the actual review sections and keeps scripted follow-ups with their selected review without network calls", async () => {
    await render(createElement(QuotesWorkspace, { mode: "demo", language: "en", canEdit: true }));
    expect(container.querySelectorAll(".quote-history button")).toHaveLength(2);
    expect(container.textContent).toContain("Demo Finishes");
    expect(container.textContent).toContain("Supplier comparison");
    expect(container.textContent).toContain("Essential questions");
    expect(container.textContent).toContain("Main risks");
    expect(container.textContent).toContain("Official budget comparison");
    expect(container.textContent).toContain("AI replies are scripted examples");
    expect(container.querySelector('.quote-chat input[type="checkbox"]')?.hasAttribute("disabled")).toBe(true);
    expect(container.querySelectorAll('.quote-chat .quote-sources a[href^="#demo-quote-"]')).toHaveLength(2);

    await input(container.querySelector(".quote-chat textarea")!, "How does this fit the budget?");
    await submit(container.querySelector(".quote-chat form")!);
    expect(container.querySelectorAll(".quote-chat-messages article")).toHaveLength(4);
    expect(container.querySelector(".quote-chat-messages article:last-child")?.textContent).toContain("500 above");

    await act(async () => { container.querySelectorAll<HTMLButtonElement>(".quote-history button")[1].click(); });
    expect(container.querySelector(".quote-result-head h2")?.textContent).toBe("Roof framing and covering");
    expect(container.querySelectorAll(".quote-chat-messages article")).toHaveLength(2);
    await act(async () => { container.querySelectorAll<HTMLButtonElement>(".quote-history button")[0].click(); });
    expect(container.querySelectorAll(".quote-chat-messages article")).toHaveLength(4);

    await click("Delete quote"); await click("Delete", container.querySelector('[role="alertdialog"]')!);
    expect(container.querySelectorAll(".quote-history button")).toHaveLength(1);
    expect(container.querySelector(".quote-result-head h2")?.textContent).toBe("Roof framing and covering");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("localizes the prepared reviews without changing USD amounts or inventing roof savings", async () => {
    await render(createElement(QuotesWorkspace, { mode: "demo", language: "en", canEdit: false, allowChat: false }));
    expect(container.textContent).toContain("USD 15,500");
    expect(container.querySelector(".quote-chat textarea")?.hasAttribute("disabled")).toBe(true);
    await render(createElement(QuotesWorkspace, { mode: "demo", language: "es", canEdit: false, allowChat: false }));
    expect(container.querySelector(".quote-result-head h2")?.textContent).toBe("Pisos y acabados · dos proveedores");
    expect(container.textContent).toContain("USD 15.500");
    expect(container.textContent).not.toMatch(/CRC|Floors and finishes|Demo Finishes/);
    await act(async () => { container.querySelectorAll<HTMLButtonElement>(".quote-history button")[1].click(); });
    expect(container.textContent).toContain("no establece un ahorro");
    expect(container.textContent).toContain("No registrado");
    expect(container.querySelectorAll(".quote-delete-button")).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("creates a clearly labeled sample from local file metadata and releases its preview URL", async () => {
    const createObjectURL = vi.fn(() => "blob:demo-local");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", class extends URL { static createObjectURL = createObjectURL; static revokeObjectURL = revokeObjectURL; });
    await render(createElement(QuotesWorkspace, { mode: "demo", language: "en", canEdit: true }));
    const picker = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    const file = new File(["Local document content"], "local-quote.pdf", { type: "application/pdf" });
    await act(async () => { Object.defineProperty(picker, "files", { value: [file] }); picker.dispatchEvent(new Event("change", { bubbles: true })); });
    await submit(container.querySelector(".quote-upload")!);
    expect(createObjectURL).toHaveBeenCalledWith(file);
    expect(container.querySelectorAll(".quote-history button")).toHaveLength(3);
    expect(container.querySelector(".quote-result-head h2")?.textContent).toBe("Example review · local-quote.pdf");
    expect(container.querySelector('.quote-record-toolbar a')?.getAttribute("href")).toBe("blob:demo-local");
    expect(container.textContent).toContain("their contents are not analyzed");
    await click("Delete quote"); await click("Delete", container.querySelector('[role="alertdialog"]')!);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:demo-local");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("interactive demo project notes", () => {
  it("supports search, creation, editing, AI access and deletion entirely locally", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    await render(createElement(NotesWorkspace, { mode: "demo", language: "en", canEdit: true }));
    expect(container.querySelectorAll(".notes-card")).toHaveLength(3);
    const search = container.querySelector<HTMLInputElement>(".notes-search input")!;
    await input(search, "waterproofing");
    expect(container.querySelectorAll(".notes-card")).toHaveLength(1);
    expect(container.querySelector(".notes-card h3")?.textContent).toContain("Next site visit");
    await input(search, "");

    await click("+ New note");
    expect(document.activeElement).toBe(container.querySelector(".notes-form input"));
    await input(container.querySelector(".notes-form input")!, "Delivery decision");
    await input(container.querySelector(".notes-form textarea")!, "Keep the final delivery slot for Friday.");
    await submit(container.querySelector(".notes-form")!);
    let card = container.querySelector<HTMLElement>(".notes-card")!;
    expect(card.querySelector("h3")?.textContent).toBe("Delivery decision");
    expect(card.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(false);
    await act(async () => { card.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click(); });
    expect(card.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(true);
    await click("Edit", card);
    await input(container.querySelector(".notes-form textarea")!, "Confirm Friday delivery with the site lead.");
    await submit(container.querySelector(".notes-form")!);
    card = container.querySelector<HTMLElement>(".notes-card")!;
    expect(card.textContent).toContain("Confirm Friday delivery with the site lead.");
    await click("Delete", card);
    expect(container.querySelectorAll(".notes-card")).toHaveLength(3);
    expect(container.textContent).not.toContain("Delivery decision");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("respects viewer access and still loads the real API when mode is omitted", async () => {
    await render(createElement(NotesWorkspace, { mode: "demo", language: "es", canEdit: false }));
    expect(container.querySelectorAll(".notes-actions button")).toHaveLength(0);
    expect(container.querySelectorAll('input[type="checkbox"]:disabled')).toHaveLength(3);
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockResolvedValueOnce(Response.json({ notes: [] }));
    await render(createElement(NotesWorkspace, { language: "es", canEdit: true }));
    expect(fetchMock).toHaveBeenCalledWith("/api/notes", { cache: "no-store" });
    expect(container.textContent).toContain("Todavía no hay notas");
    expect(container.textContent).not.toContain("paleta confirmada");
  });
});
