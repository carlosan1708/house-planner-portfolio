// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AssistantPanel from "@/app/components/AssistantPanel";

let root: Root;
let container: HTMLDivElement;
const originalScrollTo = HTMLElement.prototype.scrollTo;
const props = { language: "en" as const, role: "admin" as const, canBudget: true, canDocuments: true, canNotes: true, onOpenBudget: vi.fn() };

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Object.defineProperty(HTMLElement.prototype, "scrollTo", { value: vi.fn(), configurable: true });
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  props.onOpenBudget.mockClear();
});
afterEach(() => {
  act(() => root.unmount()); document.body.innerHTML = ""; vi.unstubAllGlobals();
  Object.defineProperty(HTMLElement.prototype, "scrollTo", { value: originalScrollTo, configurable: true });
});

async function render(mode?: "demo" | "real", language: "en" | "es" = "en") { await act(async () => { root.render(createElement(AssistantPanel, { ...props, language, ...(mode ? { mode } : {}) })); }); }
async function click(text: string) {
  const button = [...container.querySelectorAll("button")].find((item) => item.textContent === text || item.getAttribute("aria-label") === text);
  expect(button, `Missing button: ${text}`).toBeDefined();
  await act(async () => { button!.click(); });
}
async function send(text: string) {
  const textarea = container.querySelector("textarea")!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, text); textarea.dispatchEvent(new Event("input", { bubbles: true })); });
  await act(async () => { container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
}

describe("scripted demo in the actual assistant panel", () => {
  it("shows cited budget and dimension examples without contacting any API or creating proposals", async () => {
    const api = vi.fn(async () => { throw new Error("No demo API requests expected"); }); vi.stubGlobal("fetch", api);
    await render("demo"); await click("Open project assistant");
    expect(container.querySelector(".assistant-panel.open")).not.toBeNull();
    expect(container.textContent).toContain("Scripted demo · no live AI");
    expect(container.querySelectorAll(".assistant-empty button")).toHaveLength(4);
    await click("Show the sample budget and excess");
    expect(container.querySelector(".assistant-message.assistant")?.textContent).toContain("$55,000");
    expect(container.querySelector(".assistant-message.assistant")?.textContent).toContain("$6,200");
    expect(container.querySelector(".assistant-message.assistant")?.textContent).toContain("$500 excess");
    await click("▦ Fictional demo budget"); expect(props.onOpenBudget).toHaveBeenCalledWith(undefined);
    expect(container.querySelector(".assistant-proposal")).toBeNull();

    await click("New conversation"); await click("What are the house dimensions?");
    expect(container.querySelector(".assistant-message.assistant")?.textContent).toContain("120 m²");
    expect(container.querySelector(".assistant-message.assistant")?.textContent).toContain("two bedrooms and one bathroom");
    expect(container.querySelector(".assistant-citations a")?.getAttribute("href")).toBe("/demo/casa-mirador-plan.svg");
    await click("Conversation history"); expect(container.textContent).toContain("not saved");
    expect(api).not.toHaveBeenCalled();
  });

  it("localizes kitchen and saved-note examples and explicitly declines edits or web requests", async () => {
    const api = vi.fn(async () => { throw new Error("No demo API requests expected"); }); vi.stubGlobal("fetch", api);
    await render("demo", "es"); await click("Abrir asistente del proyecto"); await click("Muestra el ejemplo de cocina");
    expect(container.querySelector(".assistant-message.assistant")?.textContent).toContain("15 m²");
    expect(container.querySelector(".assistant-message.assistant")?.textContent?.replace(/\D/g, "")).toContain("10000");
    await send("¿Qué contienen las notas?");
    expect(container.querySelector(".assistant-message.assistant:last-child")?.textContent).toContain("paleta confirmada");
    expect(container.querySelector(".assistant-message.assistant:last-child")?.textContent).not.toContain("Próxima visita");
    expect(container.querySelector(".assistant-message.assistant:last-child")?.textContent).toContain("no están conectados");
    await send("Cambia el presupuesto y busca en internet el precio actual");
    expect(container.querySelector(".assistant-message.assistant:last-child")?.textContent).toContain("No genera otras respuestas");
    expect(container.querySelector(".assistant-proposal")).toBeNull();
    expect(api).not.toHaveBeenCalled();
  });

  it("keeps real mode as the default and clears real conversation data on a mode change", async () => {
    const api = vi.fn(async (input: RequestInfo | URL) => String(input).includes("?id=")
      ? Response.json({ conversation: { id: "private", messages: [{ id: "m1", role: "assistant", text: "Private project information", createdAt: "" }] } })
      : Response.json({ conversations: [{ id: "private", title: "Private conversation", lastMessage: "Existing history", updatedAt: "" }] }));
    vi.stubGlobal("fetch", api);
    await render(); await click("Open project assistant");
    expect(api).toHaveBeenCalledWith("/api/assistant/conversations");
    await click("Conversation history"); await click("Private conversationExisting history");
    expect(container.textContent).toContain("Private project information");
    const realRequests = api.mock.calls.length;
    await render("demo"); await click("Open project assistant");
    expect(container.textContent).not.toContain("Private project information");
    expect(container.textContent).not.toContain("Private conversation");
    expect(api).toHaveBeenCalledTimes(realRequests);
  });
});
