// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("next/image", () => ({ default: ({ src, alt }: { src: string; alt: string }) => createElement("img", { src, alt }) }));
vi.mock("@/lib/usage-client", () => ({ trackDemoAction: vi.fn(), trackUsageInteraction: vi.fn() }));
import ExpensesWorkspace from "@/app/components/ExpensesWorkspace";
import AestheticsWorkspace from "@/app/components/AestheticsWorkspace";
import { deriveExpensesFromBudgetLines } from "@/lib/expenses";
import type { BudgetLine } from "@/lib/workbook";
import type { PurchaseRecord } from "@/lib/expense-records";
let root: Root, host: HTMLDivElement;
let language: "en" | "es";
let workspace: "expenses" | "aesthetics";
let mode: "demo" | "real";
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host); window.history.replaceState({}, "", "/"); language = "en"; mode = "demo"; vi.stubGlobal("fetch", vi.fn()); });
afterEach(() => { act(() => root.unmount()); vi.unstubAllGlobals(); document.body.innerHTML = ""; window.history.replaceState({}, "", "/"); });
async function render(nextLanguage: "en" | "es" = language) {
  language = nextLanguage;
  await act(async () => { root.render(workspace === "expenses" ? createElement(ExpensesWorkspace, { mode, language, isOwner: true }) : createElement(AestheticsWorkspace, { mode, language, canEdit: true })); });
}
function button(text: string, within: ParentNode = host) { const found = [...within.querySelectorAll("button")].find((item) => item.textContent?.includes(text) || item.getAttribute("aria-label") === text); if (!found) throw new Error(`Missing button: ${text}`); return found; }
async function click(text: string, within: ParentNode = host) { await act(async () => { button(text, within).click(); }); }
async function input(element: HTMLInputElement | HTMLTextAreaElement, value: string) { await act(async () => { Object.getOwnPropertyDescriptor(element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, "value")!.set!.call(element, value); element.dispatchEvent(new Event("input", { bubbles: true })); }); }
async function choose(element: HTMLSelectElement, value: string) { await act(async () => { element.value = value; element.dispatchEvent(new Event("change", { bubbles: true })); }); }
function field(text: string, within: ParentNode = host) { const label = [...within.querySelectorAll("label")].find((item) => item.textContent?.startsWith(text)); if (!label) throw new Error(`Missing field: ${text}`); return label.querySelector<HTMLInputElement | HTMLTextAreaElement>("input,textarea")!; }
function photo(name: string) { const found = [...host.querySelectorAll(".aesthetic-grid article")].find((item) => item.querySelector("b")?.textContent === name); if (!found) throw new Error(`Missing photo: ${name}`); return found; }

describe("demo expense and aesthetics language projection", () => {
  it("uses a real USD project's currency for totals, new purchases and decimal payments", async () => {
    workspace = "expenses"; mode = "real";
    const line: BudgetLine = { id: "usd-line", row: 4, chapter: "Finishes", item: "Cabinetry", type: "Purchase", subcategory: "Kitchen", objective: 1800, excess: 0, quote: 1600, paid: 1250.25, supplier: "Supplier", status: "In progress" };
    vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith("/documents") ? { documents: [], purchases: [] } : url.endsWith("/purchases") ? { purchases: [] } : url.endsWith("/payments") ? { payments: [], completedLineIds: [] } : { currency: "USD", expenses: deriveExpensesFromBudgetLines([line]), budgetLines: [line], summary: { total: line.paid } }))));
    await render();
    await vi.waitFor(() => expect(host.querySelector(".expense-total strong")?.textContent).toBe("$1,250.25"));
    await click("New purchase");
    expect(host.querySelector<HTMLSelectElement>('[role="dialog"] .form-pair select')!.value).toBe("USD");
    await click("Close purchase", host.querySelector('[role="dialog"]')!); await click("Record payment");
    const dialog = host.querySelector('[role="dialog"]')!;
    const amount = dialog.querySelector<HTMLInputElement>('input[name="expense-payment-usd-amount"]')!;
    expect(amount.inputMode).toBe("decimal"); await input(amount, "12.75");
    expect(dialog.querySelector(".payment-amount-field strong")?.textContent).toContain("$12.75");
    await render("es"); expect(amount.value).toBe("12.75"); expect(dialog.querySelector(".payment-amount-field b")?.textContent).toBe("USD");
  });

  it("uses coherent USD demo totals, payments and purchase balances in both languages", async () => {
    workspace = "expenses"; await render();
    expect(host.querySelector(".expense-total strong")?.textContent).toBe("$1,250.00");
    const purchase = host.querySelector(".purchase-card")!;
    expect(purchase.querySelector("strong")?.textContent).toBe("$395.00");
    expect(purchase.textContent).toContain("Pending: $200.00");
    expect(button("Record installment", purchase).disabled).toBe(false);
    await click("Pay balance", purchase);
    const dialog = host.querySelector('[role="dialog"]')!;
    const amount = dialog.querySelector<HTMLInputElement>('input[name="expense-payment-usd-amount"]')!;
    expect(amount.value).toBe("200"); expect(amount.inputMode).toBe("decimal");
    expect(dialog.querySelector(".payment-amount-field b")?.textContent).toBe("USD");
    expect(dialog.querySelector(".payment-amount-input span")?.textContent).toBe("$");
    const purchasePicker = [...dialog.querySelectorAll("select")].find((item) => [...item.options].some((option) => option.value === "demo-purchase"))!;
    expect(purchasePicker.value).toBe("demo-purchase");
    expect(dialog.textContent).toContain("Pending for this purchase: $200.00");
    await input(amount, "125.75");
    expect(amount.value).toBe("125.75");
    expect(dialog.querySelector(".payment-amount-field strong")?.textContent).toBe("This payment: $125.75");
    await render("es");
    expect(amount.value).toBe("125.75");
    expect(dialog.querySelector(".payment-amount-field b")?.textContent).toBe("USD");
    expect(dialog.querySelector(".payment-amount-field strong")?.textContent).toContain(new Intl.NumberFormat("es-CR", { style: "currency", currency: "USD" }).format(125.75));
    await click("Cancelar", dialog); await render("en");
    await click("Documents", host.querySelector(".expense-tabs")!);
    expect(host.querySelector(".document-card strong")?.textContent).toBe("$395.00");
    await click("Link to payment", host.querySelector(".document-card")!);
    expect(host.querySelector(".receipt-payment-options strong")?.textContent).toBe("$195.00");
    await click("Close", host.querySelector('[role="dialog"]')!);
    await click("Payments", host.querySelector(".expense-tabs")!);
    expect(host.querySelector(".payment-item strong")?.textContent).toBe("$195.00");
    await click("Budget lines", host.querySelector(".expense-tabs")!);
    expect(host.querySelector(".paid-official strong")?.textContent).toBe("$1,250.00");
    expect(host.querySelector(".payment-summary strong")?.textContent).toBe("$195.00");
    expect(host.textContent).not.toContain("₡"); expect(fetch).not.toHaveBeenCalled();
  });

  it("defaults new demo purchases to USD and preserves explicit currency choices across language switches", async () => {
    workspace = "expenses"; await render(); await click("New purchase");
    const dialog = host.querySelector('[role="dialog"]')!;
    const currency = [...dialog.querySelectorAll("select")].find((item) => [...item.options].some((option) => option.value === "USD"))!;
    expect(currency.value).toBe("USD");
    await choose(currency, "CRC"); await render("es"); await render("en");
    expect(currency.value).toBe("CRC");
    await click("Close purchase", dialog); await click("New purchase");
    expect(host.querySelector<HTMLSelectElement>('[role="dialog"] .form-pair select')?.value).toBe("USD");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps real budget totals, payment forms and new-purchase defaults in CRC while retaining stored USD choices", async () => {
    workspace = "expenses"; mode = "real";
    const line: BudgetLine = { id: "private-line", row: 4, chapter: "Private finishes", item: "Private cabinetry", type: "Purchase", subcategory: "Kitchen", objective: 1800000, excess: 0, quote: 1600000, paid: 1250000, workbookPaid: 1250000, supplier: "Private supplier", status: "In progress" };
    const purchase: PurchaseRecord = { id: "crc-purchase", title: "Private materials", purchaseDate: "2026-09-12", vendor: "Private supplier", reference: "", notes: "", amount: 395000, currency: "CRC", budgetLineId: line.id, budgetLineLabel: line.item, coverPhotoId: null, photos: [], documentCount: 0, createdAt: "2026-09-12", updatedAt: "2026-09-12" };
    const usdPurchase: PurchaseRecord = { ...purchase, id: "usd-purchase", title: "Imported faucet", amount: 395, currency: "USD" };
    const request = vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith("/documents") ? { documents: [], purchases: [] } : url.endsWith("/purchases") ? { purchases: [purchase, usdPurchase] } : url.endsWith("/payments") ? { payments: [], completedLineIds: [] } : { expenses: deriveExpensesFromBudgetLines([line]), budgetLines: [line], summary: { total: line.paid } })));
    vi.stubGlobal("fetch", request); await render();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 35)); });
    await vi.waitFor(() => expect(host.querySelectorAll(".purchase-card")).toHaveLength(2));
    const crc = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "CRC", maximumFractionDigits: 0 }).format(value);
    expect(host.querySelector(".expense-total strong")?.textContent).toBe(crc(1250000));
    const cards = host.querySelectorAll(".purchase-card");
    expect(cards[0].textContent).toContain(`Pending: ${crc(395000)}`);
    expect(button("Record installment", cards[1]).disabled).toBe(true);
    await click("Edit", cards[1]);
    expect(host.querySelector<HTMLSelectElement>('[role="dialog"] .form-pair select')?.value).toBe("USD");
    await click("Close purchase", host.querySelector('[role="dialog"]')!); await click("New purchase");
    const newCurrency = host.querySelector<HTMLSelectElement>('[role="dialog"] .form-pair select')!;
    expect(newCurrency.value).toBe("CRC"); await choose(newCurrency, "USD"); await render("es"); await render("en"); expect(newCurrency.value).toBe("USD");
    await click("Close purchase", host.querySelector('[role="dialog"]')!); await click("Record payment");
    const dialog = host.querySelector('[role="dialog"]')!;
    const amount = dialog.querySelector<HTMLInputElement>('input[name="expense-payment-crc-amount"]')!;
    expect(dialog.querySelector(".payment-amount-field b")?.textContent).toBe("CRC");
    expect(dialog.querySelector(".payment-amount-input span")?.textContent).toBe("₡");
    expect(amount.inputMode).toBe("numeric"); expect(amount.placeholder).toBe("e.g. 200000");
    const picker = [...dialog.querySelectorAll("select")].find((item) => [...item.options].some((option) => option.value === purchase.id))!;
    expect([...picker.options].map((option) => option.value)).toEqual(["", purchase.id]);
    await choose(picker, purchase.id);
    await choose(dialog.querySelector<HTMLSelectElement>('select[aria-label="Budget application"]')!, "ledger");
    await input(amount, "195000");
    expect(dialog.querySelector(".payment-amount-field strong")?.textContent).toBe(`This payment: ${crc(195000)}`);
    expect(dialog.querySelector(".form-help")?.textContent || dialog.textContent).toContain(crc(1250000));
    expect(dialog.querySelector(".payment-budget-preview output")?.textContent).toBe(crc(1445000));
    const count = request.mock.calls.length; await render("es");
    expect(dialog.querySelector(".payment-amount-field b")?.textContent).toBe("CRC");
    expect(dialog.querySelector(".payment-budget-preview")?.textContent).toContain("Pagado después de guardar");
    expect(request).toHaveBeenCalledTimes(count);
  });

  it("localizes expense seeds and document enum labels while keeping filter IDs and paid chapter selection", async () => {
    workspace = "expenses"; await render();
    expect(host.querySelector(".purchase-card h3")?.textContent).toBe("Kitchen faucet");
    expect(host.querySelector(".purchase-card")?.textContent).toContain("Demo Store");
    expect(host.querySelector(".purchase-card")?.textContent).toContain("2026-09-12");
    await click("Documents", host.querySelector(".expense-tabs")!);
    expect(host.querySelector(".document-card h3")?.textContent).toBe("Faucet invoice");
    expect(host.querySelector(".document-type")?.textContent).toBe("Invoice");
    const type = host.querySelectorAll<HTMLSelectElement>(".expense-toolbar select")[1];
    expect([...type.options].map((item) => [item.value, item.text])).toEqual([["", "All types"], ["invoice", "Invoice"], ["receipt", "Receipt"], ["payroll", "Payroll"], ["other", "Other"]]);
    await choose(type, "invoice"); await render("es");
    expect(type.value).toBe("invoice"); expect(host.querySelector(".document-type")?.textContent).toBe("Factura");
    expect(host.querySelector(".document-card h3")?.textContent).toBe("Factura grifería");
    await click("Partidas", host.querySelector(".expense-tabs")!);
    const chapter = [...host.querySelectorAll<HTMLSelectElement>("select")].find((item) => [...item.options].some((option) => option.value === "Acabados"))!;
    await choose(chapter, "Acabados"); await render("en");
    expect(chapter.value).toBe("Acabados"); expect(chapter.selectedOptions[0].text).toBe("Finishes");
    expect(host.querySelector(".paid-line-card")?.textContent || host.textContent).toContain("Kitchen cabinetry");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps open expense drafts, numeric/date values and custom text including text matching another seed language", async () => {
    workspace = "expenses"; await render(); await click("Edit", host.querySelector(".purchase-card")!);
    const dialog = host.querySelector('[role="dialog"]')!;
    const title = field("Description", dialog), amount = field("Amount", dialog), date = dialog.querySelector<HTMLInputElement>('input[type="date"]')!;
    expect(title.value).toBe("Kitchen faucet");
    await input(title, "Grifería para cocina"); await input(amount, "412.75"); await input(date, "2026-09-19"); await input(field("Notes", dialog), "Mi acabado personalizado");
    await render("es"); await render("en");
    expect(host.querySelector('[role="dialog"]')).toBe(dialog);
    expect(title.value).toBe("Grifería para cocina"); expect(amount.value).toBe("412.75"); expect(date.value).toBe("2026-09-19");
    expect(field("Notes", dialog).value).toBe("Mi acabado personalizado");
    expect(field("Vendor", dialog).value).toBe("Demo Store");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("leaves private expense records verbatim while localizing UI enums without locale-triggered reload", async () => {
    workspace = "expenses"; mode = "real";
    const document = { id: "demo-document", title: "Factura grifería", documentType: "invoice", documentDate: "2026-09-12", vendor: "Tienda Demo", reference: "PRIVATE-1", notes: "Nota privada", amount: 395, currency: "USD", purchaseId: null, purchaseTitle: "", budgetLineIds: [], budgetLines: [], budgetLineId: null, budgetLineLabel: "", files: [], createdAt: "2026-09-12", updatedAt: "2026-09-12" };
    const request = vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith("/documents") ? { documents: [document], purchases: [] } : url.endsWith("/purchases") ? { purchases: [] } : url.endsWith("/payments") ? { payments: [], completedLineIds: [] } : { expenses: [], budgetLines: [], summary: { total: 0 } })));
    vi.stubGlobal("fetch", request); await render(); await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(4));
    await click("Documents", host.querySelector(".expense-tabs")!); await vi.waitFor(() => expect(host.querySelector(".document-card h3")?.textContent).toBe("Factura grifería"));
    expect(host.querySelector(".document-type")?.textContent).toBe("Invoice");
    const count = request.mock.calls.length; await render("es");
    expect(host.querySelector(".document-card h3")?.textContent).toBe("Factura grifería"); expect(host.querySelector(".document-card")?.textContent).toContain("Tienda Demo");
    expect(host.querySelector(".document-type")?.textContent).toBe("Factura"); expect(request).toHaveBeenCalledTimes(count);
  });

  it("localizes pristine aesthetic notes in an open modal and preserves custom edits and the selected image", async () => {
    workspace = "aesthetics"; await render();
    expect(photo("Main living room.jpg").textContent).toContain("Natural light and warm tones");
    await act(async () => { photo("Main living room.jpg").querySelector<HTMLButtonElement>(".aesthetic-grid-image")!.click(); });
    const viewer = host.querySelector('.aesthetic-viewer [role="dialog"]')!;
    await click("Notes", host.querySelector(".aesthetic-viewer")!);
    const notes = host.querySelector<HTMLTextAreaElement>(".aesthetic-notes-dialog textarea")!;
    expect(notes.value).toContain("Keep natural light coming in.");
    await render("es"); expect(notes.value).toContain("Mantener la entrada de luz natural.");
    expect(host.querySelector('.aesthetic-viewer [role="dialog"]')).toBe(viewer);
    expect(viewer.getAttribute("aria-label")).toBe("Sala principal.jpg");
    const customNotes = "Mantener la entrada de luz natural.\nCombinar madera clara con textiles cálidos.";
    await input(notes, "Mi nota personalizada"); await input(notes, customNotes); await render("en");
    expect(notes.value).toBe(customNotes);
    await click("Save notes", host.querySelector(".aesthetic-notes-dialog")!);
    await click("Notes", host.querySelector(".aesthetic-viewer")!);
    expect(host.querySelector<HTMLTextAreaElement>(".aesthetic-notes-dialog textarea")!.value).toBe(customNotes);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("preserves demo additions/deletions, gallery filter and uploaded user filenames across switches", async () => {
    workspace = "aesthetics"; vi.stubGlobal("URL", Object.assign(class extends URL {}, { createObjectURL: vi.fn(() => "/uploaded.png") })); await render();
    const gallery = host.querySelector<HTMLSelectElement>(".aesthetic-gallery-source select")!; await choose(gallery, "*");
    const upload = host.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(upload, "files", { value: [new File(["image"], "Cocina.jpg", { type: "image/jpeg" })], configurable: true });
    await act(async () => { upload.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(photo("Cocina.jpg")).toBeDefined();
    await act(async () => { photo("Main living room.jpg").querySelector<HTMLButtonElement>('[aria-label="Delete Main living room.jpg"]')!.click(); });
    await click("Delete", host.querySelector('[role="alertdialog"]')!);
    await render("es");
    expect(gallery.value).toBe("*"); expect(photo("Cocina.jpg")).toBeDefined();
    expect([...host.querySelectorAll(".aesthetic-grid article b")].map((item) => item.textContent)).not.toContain("Sala principal.jpg");
    await render("en"); expect(photo("Cocina.jpg")).toBeDefined();
    expect([...host.querySelectorAll(".aesthetic-grid article b")].map((item) => item.textContent)).not.toContain("Main living room.jpg");
  });

  it("uses canonical plan IDs with a localized display name and leaves user folders and private records untouched", async () => {
    workspace = "aesthetics"; await render();
    const picker = host.querySelector<HTMLSelectElement>(".aesthetic-mobile-folder-picker select")!;
    expect([...picker.options].find((item) => item.value === "demo-plans")?.text).toBe("Plans");
    await choose(picker, "demo-plans"); await render("es");
    expect(picker.value).toBe("demo-plans"); expect(host.querySelector(".aesthetic-folder-toolbar h3")?.textContent).toBe("Planos");
    expect(host.querySelector(".aesthetic-folder-actions")?.textContent).not.toMatch(/Renombrar|Eliminar/);
    act(() => root.unmount()); root = createRoot(host); mode = "real";
    const request = vi.fn(async () => new Response(JSON.stringify({ folders: [{ id: "demo-plans", name: "Planos", kind: "plans", carouselImageIds: [], createdAt: "2026-01-01" }, { id: "demo-interior", name: "Mi cocina privada", kind: "images", carouselImageIds: ["demo-1"], createdAt: "2026-01-01" }], images: [{ id: "demo-1", folderId: "demo-interior", name: "Sala principal.jpg", caption: "Luz natural y tonos cálidos", notes: "Mantener la entrada de luz natural.", width: 100, height: 100, createdAt: "2026-01-01", mediaType: "image", contentType: "image/jpeg", imageUrl: "/private.jpg", thumbnailUrl: "/private.jpg" }] })));
    vi.stubGlobal("fetch", request); await render("en"); await vi.waitFor(() => expect(host.querySelector(".aesthetic-folder-toolbar h3")?.textContent).toBe("Planos"));
    const privatePicker = host.querySelector<HTMLSelectElement>(".aesthetic-mobile-folder-picker select")!; await choose(privatePicker, "demo-interior");
    expect(photo("Sala principal.jpg").textContent).toContain("Luz natural y tonos cálidos"); const count = request.mock.calls.length;
    await render("es"); expect(photo("Sala principal.jpg").textContent).toContain("Luz natural y tonos cálidos"); expect(request).toHaveBeenCalledTimes(count);
  });
});
