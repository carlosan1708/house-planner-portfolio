// @vitest-environment jsdom

import { act, createElement, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import BudgetTableEditor from "@/app/components/BudgetTableEditor";
import type { UniverEditorHandle } from "@/app/components/UniverEditor";
import type { UniverWorkbook } from "@/lib/workbook";

function workbook(): UniverWorkbook {
  return { id: "budget", name: "Sample", sheetOrder: ["budget"], sheets: {
    budget: { id: "budget", name: "Pisos", rowCount: 10, columnCount: 26, cellData: {
      2: { 4: { v: "Objetivo" } },
      3: { 0: { v: "Pisos" }, 1: { v: "Baldosas" }, 4: { v: 100 }, 6: { v: 0 }, 8: { v: "Pendiente" }, 9: { v: 25 }, 10: { v: "Proveedor" }, 25: { v: "new:line-1" } },
    }, mergeData: [], rowData: {}, columnData: {} },
  } };
}

let root: Root | null = null;
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); });
afterEach(() => { act(() => root?.unmount()); vi.unstubAllGlobals(); root = null; document.body.innerHTML = ""; });

function changeAmount(container: HTMLDivElement, label: string, value: string) {
  const input = container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

async function renderEditor(options: { canEdit?: boolean; readOnly?: boolean; quoteDefaultsAllowed?: boolean; demo?: boolean; projectId?: string } = {}) {
  const container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  const ref = createRef<UniverEditorHandle>();
  const data = workbook();
  const onSnapshot = vi.fn();
  await act(async () => { root!.render(createElement(BudgetTableEditor, { data, ref, language: "es", canEdit: true, projectId: "sample-house", onSnapshot, ...options })); });
  return { container, ref, data, onSnapshot };
}

describe("quote defaults when committing the budget editor", () => {
  it("waits until commit, uses the final typed objective and clears a typed zero from the quote display", async () => {
    const { container, ref, data, onSnapshot } = await renderEditor();
    for (const value of ["1", "10", "1000000"]) await act(async () => { changeAmount(container, "Baldosas Objetivo", value); });
    await act(async () => { changeAmount(container, "Baldosas Cotización", "0"); changeAmount(container, "Baldosas Pagado", "35"); });
    expect(ref.current!.getSnapshot()!.sheets.budget.cellData[3][6].v).toBe(0);
    expect(onSnapshot.mock.calls.every(([snapshot]) => snapshot.sheets.budget.cellData[3][6].v === 0)).toBe(true);
    await act(async () => { await ref.current!.commitPendingEdit(); });
    const committed = ref.current!.getSnapshot()!;
    expect(committed.sheets.budget.cellData[3][6].v).toBe(1000000);
    expect(container.querySelector<HTMLInputElement>('input[aria-label="Baldosas Cotización"]')!.value).toBe("1000000");
    expect(container.querySelector<HTMLInputElement>('input[aria-label="Baldosas Pagado"]')!.value).toBe("35");
    expect(data.sheets.budget.cellData[3][6].v).toBe(0);
    await act(async () => { await ref.current!.commitPendingEdit(); });
    expect(ref.current!.getSnapshot()).toBe(committed);
  });

  it.each([{ readOnly: true }, { canEdit: false, quoteDefaultsAllowed: true }, { quoteDefaultsAllowed: false }, { demo: true, quoteDefaultsAllowed: true }, { projectId: "another-project" }])("keeps the snapshot unchanged when defaults do not apply: %j", async (options) => {
    const { ref, data, onSnapshot } = await renderEditor(options);
    await act(async () => { expect(await ref.current!.commitPendingEdit()).toBe(data); });
    expect(ref.current!.getSnapshot()).toBe(data);
    expect(onSnapshot).not.toHaveBeenCalled();
  });

  it("fills quotes during an authorized save while inputs are temporarily read-only", async () => {
    const { container, ref, onSnapshot } = await renderEditor({ readOnly: true, quoteDefaultsAllowed: true });
    await act(async () => { await ref.current!.commitPendingEdit(); });
    expect(ref.current!.getSnapshot()!.sheets.budget.cellData[3][6].v).toBe(100);
    expect(container.querySelector<HTMLInputElement>('input[aria-label="Baldosas Cotización"]')!.value).toBe("100");
    expect(onSnapshot).toHaveBeenCalledTimes(1);
  });

  it("rejects an incomplete amount before filling a quote", async () => {
    const { container, ref } = await renderEditor();
    await act(async () => { changeAmount(container, "Baldosas Objetivo", ""); });
    await expect(ref.current!.commitPendingEdit()).rejects.toThrow("Corrige el importe antes de guardar.");
    expect(ref.current!.getSnapshot()!.sheets.budget.cellData[3][6].v).toBe(0);
  });
});
