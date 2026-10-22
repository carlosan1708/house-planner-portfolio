// @vitest-environment jsdom

import { act, createElement, forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/dynamic", () => ({
  default: () => forwardRef(function MockSpreadsheet(props: { data: MockWorkbook; readOnly?: boolean; initialActiveSheet?: { id: string; name: string } | null }, ref) {
    const snapshot = useRef(structuredClone(props.data));
    const pendingValue = useRef<number | null>(null);
    useEffect(() => { snapshot.current = structuredClone(props.data); }, [props.data]);
    useImperativeHandle(ref, () => ({
      getSnapshot: () => snapshot.current,
      getActiveSheet: () => ({ id: "category-1", name: "Structure" }),
      commitPendingEdit: async () => {
        if (pendingValue.current !== null) snapshot.current.sheets["category-1"].cellData[3][4].v = pendingValue.current;
        pendingValue.current = null;
        return snapshot.current;
      },
    }), []);
    return createElement("div", null,
      createElement("button", {
        disabled: props.readOnly,
        onClick: () => { pendingValue.current = 999; },
      }, props.readOnly ? "Read-only current sheet" : "Edit current cell"),
      createElement("span", null, `Restored sheet: ${props.initialActiveSheet?.name || "none"}`),
    );
  }),
}));

import BudgetWorkspace from "@/app/components/BudgetWorkspace";

type MockWorkbook = {
  id: string; name: string; sheetOrder: string[];
  sheets: Record<string, { id: string; name: string; rowCount: number; columnCount: number; cellData: Record<number, Record<number, { v?: number | string }>>; rowData: Record<number, object>; columnData: Record<number, object>; mergeData: never[] }>;
};

const workbook = (): MockWorkbook => ({
  id: "test", name: "Test", sheetOrder: ["category-1"],
  sheets: { "category-1": { id: "category-1", name: "Structure", rowCount: 30, columnCount: 18, cellData: { 2: { 4: { v: "Objective" } }, 3: { 0: { v: "Structure" }, 1: { v: "Concrete" }, 4: { v: 100 }, 9: { v: 20 }, 25: { v: "line-1" } } }, rowData: {}, columnData: {}, mergeData: [] } },
});

const budget = {
  currency: "CRC", objective: 100, excess: 0, spent: 20, remaining: 80, percentUsed: 20, status: "within",
  lines: [{ id: "line-1", row: 4, chapter: "Structure", item: "Concrete", type: "Construction", subcategory: "Foundation", objective: 100, excess: 0, quote: 100, paid: 20, supplier: "", status: "" }],
  summaries: { chapter: [{ label: "Structure", objective: 100, excess: 0, spent: 20, count: 1 }], type: [{ label: "Construction", objective: 100, excess: 0, spent: 20, count: 1 }], subcategory: [{ label: "Foundation", objective: 100, excess: 0, spent: 20, count: 1 }] },
  unsupported: [], editingAllowed: true, planVersion: 1, actualsRevision: 0,
};

let root: Root | null = null;
afterEach(() => { act(() => root?.unmount()); root = null; vi.unstubAllGlobals(); document.body.innerHTML = ""; });

async function exerciseWorkflow(isOwner: boolean, saveFirst = false, failFirstPublication = false) {
  const actions: Array<{ action: string; workbook?: MockWorkbook }> = [];
  let createdDrafts = 0;
  let failedPublication = false;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/budget") return new Response(JSON.stringify(budget), { status: 200 });
    if (url === "/api/workbook/drafts") {
      const body = JSON.parse(String(init?.body || "{}")); actions.push(body);
      if (body.action === "create") { createdDrafts += 1; return new Response(JSON.stringify({ id: `draft-${createdDrafts}`, revision: 1, workbook: workbook(), rowMaps: { Structure: { 4: 4 } } }), { status: 201 }); }
      if (body.action === "save") return new Response(JSON.stringify({ revision: 2 }), { status: 200 });
      if (body.action === "publish" && failFirstPublication && !failedPublication) { failedPublication = true; return new Response("", { status: 500 }); }
      if (body.action === "publish") return new Response(JSON.stringify({ status: "published", planVersion: 2 }), { status: 200 });
      if (body.action === "submit") return new Response(JSON.stringify({ status: "submitted", approvalId: "approval-1" }), { status: 202 });
    }
    throw new Error(`Unexpected request: ${url}`);
  }));
  const container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  await act(async () => { root!.render(createElement(BudgetWorkspace, { mode: "real", language: "en", canEdit: true, canReplace: isOwner, isOwner, onReplace: () => undefined })); });
  await vi.waitFor(() => expect([...container.querySelectorAll("button")].some((button) => button.textContent?.includes("Edit budget"))).toBe(true));
  expect(container.textContent?.includes("Version history")).toBe(isOwner);
  await act(async () => { [...container.querySelectorAll("button")].find((button) => button.textContent?.includes("Edit budget"))!.click(); });
  await vi.waitFor(() => expect(container.querySelector('input[aria-label="Concrete Objective"]')).not.toBeNull());
  act(() => { const input = container.querySelector('input[aria-label="Concrete Objective"]')!; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "999"); input.dispatchEvent(new Event("input", { bubbles: true })); });
  if (saveFirst) {
    await act(async () => { [...container.querySelectorAll("button")].find((button) => button.textContent === "Save")!.click(); });
    await vi.waitFor(() => expect(actions.map((item) => item.action)).toEqual(["create", "save"]));
    expect(actions[1].workbook?.sheets["category-1"].cellData[3][4].v).toBe(999);
    expect(container.textContent).toContain("Saved · continuing on this sheet");
    expect(container.querySelector('input[aria-label="Concrete Objective"]')).not.toBeNull();
  }
  if (failFirstPublication) {
    await act(async () => { [...container.querySelectorAll("button")].find((button) => button.textContent === "Save")!.click(); });
    await vi.waitFor(() => expect(container.textContent).toContain("Tus cambios siguen en la pantalla"));
    const input = container.querySelector('input[aria-label="Concrete Objective"]') as HTMLInputElement;
    expect(input.value).toBe("999"); expect(input.disabled).toBe(false);
    expect(actions.map((item) => item.action)).toEqual(["create", "save", "publish"]);
    actions.splice(1);
  }
  const actionLabel = isOwner ? "Save" : "Submit draft";
  await act(async () => { [...container.querySelectorAll("button")].find((button) => button.textContent === actionLabel)!.click(); });
  const saves = saveFirst ? ["save", "save"] : ["save"];
  await vi.waitFor(() => expect(actions.map((item) => item.action)).toEqual(isOwner ? ["create", ...saves, "publish", "create"] : ["create", ...saves, "submit"]));
  expect(actions[1].workbook?.sheets["category-1"].cellData[3][4].v).toBe(999);
  await vi.waitFor(() => expect(container.textContent).toContain(isOwner ? "Published · ready to continue editing" : "Submitted for owner approval"));
  expect((container.querySelector('input[aria-label="Concrete Objective"]') as HTMLInputElement).disabled).toBe(!isOwner);
}

describe("workbook save and promotion workflow", () => {
  it("preserves an edited line and lets Save retry after an empty server error", async () => { await exerciseWorkflow(true, false, true); });
  it("saves explicitly without leaving the active sheet before publication", async () => { await exerciseWorkflow(false, true); });
  it("commits the pending cell and keeps an administrator on the active editable sheet after publishing", async () => { await exerciseWorkflow(true); });
  it("commits the pending cell and keeps an editor on the active read-only sheet after submission", async () => { await exerciseWorkflow(false); });
});

describe("assistant workbook drafts", () => {
  it("opens the exact draft created by the assistant", async () => {
    const opened = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/budget") return new Response(JSON.stringify(budget), { status: 200 });
      if (url === "/api/workbook/drafts?id=assistant-draft") return new Response(JSON.stringify({ draft: { id: "assistant-draft", revision: 2, status: "editing", scope: null, rowMaps: null }, workbook: workbook() }), { status: 200 });
      throw new Error(`Unexpected request: ${url}`);
    }));
    const container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
    await act(async () => { root!.render(createElement(BudgetWorkspace, { mode: "real", language: "en", canEdit: true, canReplace: true, isOwner: true, onReplace: () => undefined, assistantDraftId: "assistant-draft", onAssistantDraftOpened: opened })); });
    await vi.waitFor(() => expect(container.textContent).toContain("Assistant draft ready for review"));
    expect(container.querySelector('input[aria-label="Concrete Objective"]')).not.toBeNull();
    expect(opened).toHaveBeenCalledTimes(1);
  });
});
