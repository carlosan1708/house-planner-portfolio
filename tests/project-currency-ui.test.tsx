// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ProjectCurrencyDialog from "@/app/components/ProjectCurrencyDialog";
import { currencyFromNumberFormat } from "@/lib/currency";

let root: Root, host: HTMLDivElement;
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

it("saves the selected project denomination and revision independently of language", async () => {
  const onSave = vi.fn(async () => true), onClose = vi.fn();
  const project = { id: "synthetic-house", name: "Synthetic house", currency: "USD" as const, currencyRevision: 3, currencyLocked: false };
  await act(async () => root.render(createElement(ProjectCurrencyDialog, { project, language: "es", busy: false, onSave, onClose })));
  const select = host.querySelector("select")!;
  expect(select.value).toBe("USD");
  await act(async () => { select.value = "CRC"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  await act(async () => root.render(createElement(ProjectCurrencyDialog, { project, language: "en", busy: false, onSave, onClose })));
  expect(select.value).toBe("CRC");
  await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(onSave).toHaveBeenCalledWith(project, "CRC", false); expect(onClose).toHaveBeenCalledOnce();
});

it("requires explicit denomination confirmation for a populated project and keeps every amount unchanged", async () => {
  const onSave = vi.fn(async () => true);
  await act(async () => root.render(createElement(ProjectCurrencyDialog, { project: { id: "legacy", name: "Legacy house", currencyLocked: true }, language: "en", busy: false, onSave, onClose: vi.fn() })));
  expect(host.querySelector("select")!.value).toBe("CRC");
  expect(host.querySelector("select")!.disabled).toBe(false);
  await act(async () => { const select = host.querySelector("select")!; select.value = "USD"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
  expect(host.textContent).toContain("keeping all amounts without conversion");
  expect(host.textContent).toContain("Purchases and receipts retain their own currencies");
  await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(onSave).not.toHaveBeenCalled();
  await act(async () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
  expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(false);
  await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ id: "legacy" }), "USD", true);
});

it("clears confirmation when the target denomination changes", async () => {
  await act(async () => root.render(createElement(ProjectCurrencyDialog, { project: { id: "legacy", name: "Legacy house", currencyLocked: true }, language: "en", busy: false, onSave: vi.fn(async () => true), onClose: vi.fn() })));
  const select = host.querySelector("select")!;
  await act(async () => { select.value = "USD"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  await act(async () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
  await act(async () => { select.value = "CRC"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  await act(async () => { select.value = "USD"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(false);
});

it("retains settings after a rejected update", async () => {
  const onClose = vi.fn(), onSave = vi.fn(async () => false);
  await act(async () => root.render(createElement(ProjectCurrencyDialog, { project: { id: "house", name: "House", currency: "CRC" }, language: "en", busy: false, onSave, onClose })));
  await act(async () => { const select = host.querySelector("select")!; select.value = "USD"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(onClose).not.toHaveBeenCalled(); expect(host.querySelector("select")!.value).toBe("USD");
});

it("distinguishes dollar amounts from Excel locale and percentage directives", () => {
  expect(currencyFromNumberFormat('$#,##0.00')).toBe("USD");
  expect(currencyFromNumberFormat('₡#,##0')).toBe("CRC");
  expect(currencyFromNumberFormat('[$-409]0%')).toBeNull();
  expect(currencyFromNumberFormat('[$-409]m/d/yyyy')).toBeNull();
});
