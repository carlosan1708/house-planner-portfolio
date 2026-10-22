// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ExpensesWorkspace from "@/app/components/ExpensesWorkspace";
import type { ExpenseDocumentRecord, ExpensePaymentRecord, PurchaseRecord } from "@/lib/expense-records";
import type { BudgetLine } from "@/lib/workbook";

vi.mock("next/image", () => ({ default: (props: Record<string, unknown>) => { const imageProps = { ...props }; delete imageProps.unoptimized; return createElement("img", imageProps); } }));
vi.mock("@/lib/usage-client", () => ({ trackDemoAction: vi.fn(), trackUsageInteraction: vi.fn() }));
vi.mock("@/lib/upload-progress", () => ({ uploadFormData: (url: string, body: FormData) => fetch(url, { method: "POST", body }) }));

const file = { id: "photo", name: "Factura.jpg", contentType: "image/jpeg", size: 100, createdAt: "2026-10-15", isImage: true, thumbnailUrl: "/photo-thumb.jpg", previewUrl: "/photo.jpg" };
const receipt: ExpenseDocumentRecord = { id: "receipt", title: "Factura compartida", documentType: "invoice", documentDate: "", vendor: "Tienda", reference: "", notes: "", amount: null, currency: "CRC", purchaseId: null, purchaseTitle: "", budgetLineIds: [], budgetLines: [], budgetLineId: null, budgetLineLabel: "", files: [file], createdAt: "2026-10-15", updatedAt: "2026-10-15" };
const purchase: PurchaseRecord = { id: "purchase", title: "Materiales", purchaseDate: "", vendor: "Tienda", reference: "", notes: "", amount: 1000, currency: "CRC", budgetLineId: null, budgetLineLabel: "", coverPhotoId: null, photos: [], documentCount: 0, createdAt: "", updatedAt: "" };
const payment: ExpensePaymentRecord = { id: "old-payment", budgetLineId: null, budgetLineLabel: "", purchaseId: "purchase", amount: 400, paymentDate: "2026-10-15", payee: "Primer abono", reference: "", notes: "", documentId: null, documentTitle: "", documentType: null, documentIds: [], accountingMode: "ledger", paymentKind: "partial", createdAt: "", updatedAt: "" };
const budgetLine: BudgetLine = { id: "budget-line", row: 4, chapter: "Acabados", item: "Pisos", type: "Compra", subcategory: "Cerámica", objective: 2000, excess: 0, quote: 1800, paid: 0, supplier: "Tienda", status: "Pendiente" };
let host: HTMLDivElement, root: Root;
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); window.history.replaceState({}, "", "/projects/house/expenses"); host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); vi.unstubAllGlobals(); document.body.innerHTML = ""; window.history.replaceState({}, "", "/"); });

function api(options: { failSave?: boolean; legacy?: boolean; purchaseAmount?: number; budgetLines?: BudgetLine[]; purchaseBudgetLineId?: string; failInitialLoad?: boolean; payments?: ExpensePaymentRecord[] } = {}) {
  let documents = [{ ...structuredClone(receipt), id: options.legacy ? "legacy:old-file" : receipt.id }], payments = structuredClone(options.payments || [payment]), failed = false, failedLoad = false;
  const request = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/purchases")) return Response.json({ purchases: [{ ...purchase, budgetLineId: options.purchaseBudgetLineId ?? purchase.budgetLineId, amount: options.purchaseAmount ?? purchase.amount }] });
    if (url.endsWith("/documents")) {
      if (init?.method === "POST") { documents = [...documents, { ...receipt, id: "uploaded", title: "Nueva.jpg", files: [{ ...file, name: "Nueva.jpg" }] }]; return Response.json({ id: "uploaded" }, { status: 201 }); }
      return Response.json({ documents, purchases: [purchase] });
    }
    if (url.endsWith("/payments")) {
      if (init?.method === "POST" || init?.method === "PATCH") {
        const body = JSON.parse(String(init.body));
        if (options.failSave && !failed) { failed = true; return Response.json({ error: "Temporal" }, { status: 503 }); }
        if (init.method === "PATCH") payments = payments.map((item) => item.id === body.id ? { ...item, ...body } : item);
        else payments = [...payments, { ...payment, ...body, id: "new-payment" }];
        return Response.json({ id: body.id || "new-payment" });
      }
      return Response.json({ payments, completedLineIds: [] });
    }
    if (options.failInitialLoad && !failedLoad) { failedLoad = true; return Response.json({ error: "No se pudieron cargar los pagos" }, { status: 503 }); }
    return Response.json({ expenses: [], budgetLines: options.budgetLines || [], summary: { total: 0 } });
  });
  vi.stubGlobal("fetch", request);
  return { request, writes: () => request.mock.calls.filter(([, init]) => init?.method), payments: () => payments };
}
async function render(owner = true) { await act(async () => root.render(createElement(ExpensesWorkspace, { mode: "real", language: "es", isOwner: owner }))); await act(async () => { await new Promise((resolve) => setTimeout(resolve, 35)); }); }
async function renderEmbedded(options: { onPaymentClose?: () => void; onPaymentSaved?: (payment: { budgetLineId: string; amount: number }) => void | Promise<void>; owner?: boolean } = {}) {
  const { owner = true, ...callbacks } = options;
  await act(async () => root.render(createElement(ExpensesWorkspace, { mode: "real", language: "es", isOwner: owner, paymentContext: { budgetLineId: budgetLine.id, item: budgetLine.item }, ...callbacks })));
  await settleEmbedded();
}
async function settleEmbedded() { for (let turn = 0; turn < 2; turn += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); }); }
function button(text: string, scope: ParentNode = host) { const result = [...scope.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent === text || item.getAttribute("aria-label") === text); expect(result, text).toBeTruthy(); return result!; }
async function click(text: string, scope?: ParentNode) { await act(async () => button(text, scope).click()); }
function dialog() { return host.querySelector<HTMLElement>('[role="dialog"]')!; }
async function value(selector: string, next: string) { await act(async () => { const input = dialog().querySelector<HTMLInputElement>(selector)!; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, next); input.dispatchEvent(new Event("input", { bubbles: true })); }); }
async function selectValue(selector: string, next: string) { await act(async () => { const select = dialog().querySelector<HTMLSelectElement>(selector)!; select.value = next; select.dispatchEvent(new Event("change", { bubbles: true })); }); }
async function upload(scope: ParentNode) { await act(async () => { const input = scope.querySelector<HTMLInputElement>('input[type="file"]')!; Object.defineProperty(input, "files", { configurable: true, value: [new File(["jpeg"], "Nueva.jpg", { type: "image/jpeg" })] }); input.dispatchEvent(new Event("change", { bubbles: true })); }); }

describe("independent receipts and real payments", () => {
  it("uploads a receipt without an amount, payment, purchase or budget line", async () => {
    const mock = api(); await render(); await click("Subir comprobantes");
    expect(dialog().querySelector('input[name="expense-payment-crc-amount"]')).toBeNull(); expect(dialog().querySelectorAll("select")).toHaveLength(1);
    await upload(dialog()); await click("Guardar comprobante", dialog());
    expect(mock.writes()).toHaveLength(1); const [url, init] = mock.writes()[0]; expect(url).toBe("/api/expenses/documents");
    const form = init!.body as FormData; expect(form.get("amount")).toBe(""); expect(form.getAll("budgetLineIds")).toEqual([]); expect(form.get("purchaseId")).toBe("");
    expect(host.textContent).toContain("No se registró ningún gasto"); expect(host.textContent).toContain("Pendiente de vincular"); expect(mock.payments()).toHaveLength(1);
  });

  it("links a pending receipt to an existing unassigned payment without changing its amount", async () => {
    const mock = api(); await render(); await click("Comprobantes1"); await click("Vincular a pago");
    expect(dialog().textContent).toContain("Sin asignar");
    await act(async () => dialog().querySelector<HTMLButtonElement>(".receipt-payment-options button")!.click());
    expect(mock.writes()).toHaveLength(1); const body = JSON.parse(String(mock.writes()[0][1]!.body));
    expect(body).toMatchObject({ id: payment.id, budgetLineId: null, amount: 400, documentIds: [receipt.id] });
    expect(host.textContent).toContain("Comprobante vinculado"); expect(mock.payments()[0].documentIds).toEqual([receipt.id]);
  });

  it("creates a payment with an existing photo and no budget assignment", async () => {
    const mock = api(); await render(); await click("Registrar pago"); await value('input[name="expense-payment-crc-amount"]', "250"); await click("Elegir comprobantes existentes", dialog()); await click(receipt.title, dialog());
    expect(dialog().querySelector("img")?.getAttribute("src")).toBe(file.thumbnailUrl); expect(mock.writes()).toHaveLength(0);
    await click("Guardar pago", dialog()); expect(dialog()).toBeNull(); expect(mock.payments()).toHaveLength(2);
    const body = JSON.parse(String(mock.writes()[0][1]!.body)); expect(body).toMatchObject({ budgetLineId: null, purchaseId: null, amount: 250, documentIds: [receipt.id], paymentKind: "partial" }); expect(body.clientMutationId).toMatch(/^[\da-f-]{36}$/);
  });

  it("prefills a settlement from its own agreed total and previous payments", async () => {
    const mock = api(); await render(); await click("Pagar saldo"); expect(dialog().querySelector<HTMLInputElement>('input[name="expense-payment-crc-amount"]')?.value).toBe("600");
    await click("Guardar pago", dialog()); expect(JSON.parse(String(mock.writes()[0][1]!.body))).toMatchObject({ purchaseId: purchase.id, budgetLineId: null, amount: 600, paymentKind: "settlement" });
  });

  it("preserves decimal CRC balances rather than multiplying their digits", async () => {
    const mock = api({ purchaseAmount: 1000.75 }); await render(); await click("Pagar saldo"); expect(dialog().querySelector<HTMLInputElement>('input[name="expense-payment-crc-amount"]')?.value).toBe("600.75");
    await value('input[name="expense-payment-crc-amount"]', "600.70");
    await click("Guardar pago", dialog()); expect(JSON.parse(String(mock.writes()[0][1]!.body))).toMatchObject({ amount: 600.7, paymentKind: "partial" });
  });

  it("stages new uploads until save and reuses the uploaded receipt and payment mutation identity on retry", async () => {
    const mock = api({ failSave: true }); await render(); await click("Registrar pago"); await value('input[name="expense-payment-crc-amount"]', "80"); await upload(dialog()); expect(mock.writes()).toHaveLength(0);
    await click("Guardar pago", dialog()); expect(dialog().textContent).toContain("Temporal"); await click("Guardar pago", dialog());
    expect(mock.writes().filter(([url]) => url === "/api/expenses/documents")).toHaveLength(1);
    const attempts = mock.writes().filter(([url]) => url === "/api/expenses/payments").map(([, init]) => JSON.parse(String(init!.body)));
    expect(attempts).toHaveLength(2); expect(attempts[0].clientMutationId).toBe(attempts[1].clientMutationId); expect(attempts[1].documentIds).toEqual(["uploaded"]);
  });

  it("cancels queued files and receipt selection without writes", async () => {
    const mock = api(); await render(); await click("Registrar pago"); await upload(dialog()); await click("Elegir comprobantes existentes", dialog()); await click(receipt.title, dialog()); await click("Cancelar", dialog()); expect(mock.writes()).toHaveLength(0); expect(dialog()).toBeNull();
  });

  it("does not expose receipt or payment creation to viewers", async () => {
    const mock = api(); await render(false); expect(host.textContent).not.toContain("Subir comprobantes"); expect(host.textContent).not.toContain("Registrar pago"); expect(mock.writes()).toHaveLength(0);
  });

  it("opens an independent payment from the budget action URL without requiring a paid line", async () => {
    api(); window.history.replaceState({}, "", "/projects/house/expenses?newPayment=1&paymentKind=partial&expenseTab=payments"); await render(); await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(dialog()).not.toBeNull(); expect(dialog().querySelector<HTMLInputElement>('input[name="expense-payment-crc-amount"]')?.value).toBe(""); expect(new URL(window.location.href).searchParams.has("newPayment")).toBe(false);
  });

  it("offers legacy receipt photos for payment reuse without changing their metadata", async () => {
    const mock = api({ legacy: true }); await render(); await click("Comprobantes1"); const card = host.querySelector(".document-card")!;
    expect(card.textContent).toContain("Vincular a pago"); expect(card.textContent).not.toContain("Editar"); expect(card.textContent).not.toContain("Eliminar");
    await click("Registrar pago", card); expect(dialog().querySelector('button[aria-label="Factura compartida"]')?.getAttribute("aria-pressed")).toBe("true"); await value('input[name="expense-payment-crc-amount"]', "10"); await click("Guardar pago", dialog());
    expect(JSON.parse(String(mock.writes()[0][1]!.body)).documentIds).toEqual(["legacy:old-file"]);
  });
});

describe("payments inside the budget", () => {
  it("ignores expense action flags and preserves the budget URL when opening and cancelling", async () => {
    const mock = api({ budgetLines: [budgetLine] }), onPaymentClose = vi.fn();
    window.history.replaceState({}, "", "/projects/house/budget?expenseTab=documents&newPayment=1&budgetLine=another-line#category");
    const before = window.location.href;
    await renderEmbedded({ onPaymentClose });
    expect(window.location.href).toBe(before);
    expect(host.querySelector(".expense-tabs")).toBeNull();
    expect(dialog().querySelector("h2")?.textContent).toBe("Pago");
    expect(dialog().textContent).toContain("Partida: Pisos");
    expect(dialog().textContent).toContain("Este pago se sumará a Pagado en esta partida");
    await click("Cancelar", dialog());
    expect(onPaymentClose).toHaveBeenCalledOnce(); expect(dialog()).toBeNull(); expect(mock.writes()).toHaveLength(0);
    expect(window.location.href).toBe(before);
  });

  it("keeps the selected budget item fixed when choosing a purchase with another item", async () => {
    const mock = api({ budgetLines: [budgetLine, { ...budgetLine, id: "another-line", item: "Ventanas" }], purchaseBudgetLineId: "another-line" });
    const onPaymentClose = vi.fn(), onPaymentSaved = vi.fn(async () => {});
    await renderEmbedded({ onPaymentClose, onPaymentSaved });
    expect(dialog().textContent).not.toContain("Partida (opcional)");
    await act(async () => {
      const select = [...dialog().querySelectorAll("select")].find((item) => [...item.options].some((option) => option.value === purchase.id))!;
      select.value = purchase.id; select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await value('input[name="expense-payment-crc-amount"]', "125");
    await click("Elegir comprobantes existentes", dialog()); await click(receipt.title, dialog());
    await click("Guardar pago", dialog());
    const body = JSON.parse(String(mock.writes()[0][1]!.body));
    expect(body).toMatchObject({ budgetLineId: budgetLine.id, purchaseId: purchase.id, amount: 125, documentIds: [receipt.id] });
    expect(onPaymentSaved).toHaveBeenCalledExactlyOnceWith({ budgetLineId: budgetLine.id, amount: 125 });
    expect(onPaymentClose).toHaveBeenCalledOnce(); expect(dialog()).toBeNull();
  });

  it("does not expose a second payment save when the budget refresh fails after a committed payment", async () => {
    const mock = api({ budgetLines: [budgetLine] }), onPaymentClose = vi.fn();
    const onPaymentSaved = vi.fn(async () => { throw new Error("Budget temporarily unavailable"); });
    await renderEmbedded({ onPaymentClose, onPaymentSaved });
    await value('input[name="expense-payment-crc-amount"]', "250"); await click("Guardar pago", dialog());
    expect(mock.writes()).toHaveLength(1); expect(onPaymentSaved).toHaveBeenCalledOnce(); expect(onPaymentClose).not.toHaveBeenCalled();
    expect(dialog().querySelector("h2")?.textContent).toBe("Pago guardado");
    expect(dialog().querySelector('[role="alert"]')?.textContent).toContain("Pago guardado. No se pudo actualizar el presupuesto");
    expect(dialog().querySelector('input[name="expense-payment-crc-amount"]')).toBeNull();
    expect([...dialog().querySelectorAll("button")].map((item) => item.textContent)).not.toContain("Guardar pago");
    expect([...dialog().querySelectorAll("button")].map((item) => item.textContent)).not.toContain("Reintentar");
    await click("Cerrar", dialog()); expect(onPaymentClose).toHaveBeenCalledOnce(); expect(mock.writes()).toHaveLength(1);
  });

  it("waits for the canonical budget refresh before closing a committed payment", async () => {
    const mock = api({ budgetLines: [budgetLine] }), onPaymentClose = vi.fn();
    let finishRefresh!: () => void;
    const onPaymentSaved = vi.fn(() => new Promise<void>((resolve) => { finishRefresh = resolve; }));
    await renderEmbedded({ onPaymentClose, onPaymentSaved });
    await value('input[name="expense-payment-crc-amount"]', "100"); await click("Guardar pago", dialog());
    expect(mock.writes()).toHaveLength(1); expect(onPaymentClose).not.toHaveBeenCalled();
    expect(dialog().textContent).toContain("Actualizando el acumulado pagado");
    expect([...dialog().querySelectorAll("button")].every((item) => item.disabled)).toBe(true);
    expect(dialog().contains(document.activeElement)).toBe(true);
    await act(async () => finishRefresh());
    expect(onPaymentClose).toHaveBeenCalledOnce(); expect(dialog()).toBeNull(); expect(mock.writes()).toHaveLength(1);
  });

  it("allows cancellation while payment options are loading without writing a payment", async () => {
    const request = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(() => new Promise<Response>(() => {})), onPaymentClose = vi.fn(); vi.stubGlobal("fetch", request);
    await renderEmbedded({ onPaymentClose });
    expect(dialog().textContent).toContain("Cargando opciones del pago");
    await click("Cerrar", dialog());
    expect(onPaymentClose).toHaveBeenCalledOnce(); expect(dialog()).toBeNull();
    expect(request.mock.calls.every(([, init]) => !init?.method)).toBe(true);
  });

  it("retries a failed initial load without submitting a payment", async () => {
    const mock = api({ budgetLines: [budgetLine], failInitialLoad: true });
    await renderEmbedded(); expect(dialog().textContent).toContain("No se pudieron cargar los pagos");
    await click("Reintentar", dialog()); await settleEmbedded();
    expect(dialog().querySelector('input[name="expense-payment-crc-amount"]')).not.toBeNull(); expect(mock.writes()).toHaveLength(0);
    expect(mock.request.mock.calls.filter(([url]) => url === "/api/expenses")).toHaveLength(2);
  });

  it("does not open a payment form for a reader", async () => {
    const mock = api({ budgetLines: [budgetLine] }); await renderEmbedded({ owner: false });
    expect(dialog().textContent).toContain("Tu acceso actual no permite registrar pagos");
    expect(dialog().querySelector('input[name="expense-payment-crc-amount"]')).toBeNull(); expect(mock.writes()).toHaveLength(0);
  });

  it("does not offer payment creation for a budget item that no longer exists", async () => {
    const mock = api(); await renderEmbedded();
    expect(dialog().textContent).toContain("Esta partida ya no está disponible");
    expect(dialog().querySelector('input[name="expense-payment-crc-amount"]')).toBeNull(); expect(mock.writes()).toHaveLength(0);
  });
});

describe("payments already included in Excel", () => {
  const accountingSelect = 'select[aria-label="Aplicación al presupuesto"]';

  it("requires an explicit choice before any receipt upload and preserves Excel totals for historical detail", async () => {
    const mock = api({ budgetLines: [{ ...budgetLine, paid: 515300, workbookPaid: 515300 }], payments: [] });
    await renderEmbedded();
    expect(dialog().querySelector<HTMLSelectElement>(accountingSelect)?.value).toBe("");
    await value('input[name="expense-payment-crc-amount"]', "515300"); await upload(dialog());
    await click("Guardar pago", dialog());
    expect(dialog().querySelector('[role="alert"]')?.textContent).toBe("Indica si es un pago nuevo o ya incluido en Excel");
    expect(mock.writes()).toHaveLength(0);
    await selectValue(accountingSelect, "historical-detail");
    expect(dialog().textContent).toContain("Histórico de Excel disponible por detallar");
    expect(dialog().querySelector('output[aria-label="Pagado después de guardar"]')?.textContent).toContain("515");
    await click("Elegir comprobantes existentes", dialog()); await click(receipt.title, dialog()); await click("Guardar pago", dialog());
    const writes = mock.writes(); expect(writes).toHaveLength(2); expect(writes[0][0]).toBe("/api/expenses/documents");
    expect(JSON.parse(String(writes[1][1]!.body))).toMatchObject({ budgetLineId: budgetLine.id, accountingMode: "historical-detail", amount: 515300, documentIds: [receipt.id, "uploaded"] });
  });

  it("reclassifies the duplicated 515300 ledger payment without changing its amount or receipts", async () => {
    const duplicatedPayment = { ...payment, budgetLineId: budgetLine.id, amount: 515300, documentIds: [receipt.id] };
    const mock = api({ budgetLines: [{ ...budgetLine, paid: 1030600, workbookPaid: 515300 }], payments: [duplicatedPayment] });
    await render(); await click("Pagos1"); await click("Editar");
    expect(dialog().querySelector<HTMLSelectElement>(accountingSelect)?.value).toBe("ledger");
    expect(dialog().querySelector<HTMLInputElement>('input[name="expense-payment-crc-amount"]')?.value).toBe("515300");
    await selectValue(accountingSelect, "historical-detail");
    const preview = dialog().querySelector('output[aria-label="Pagado después de guardar"]')?.textContent || "";
    expect(preview.replace(/[^\d]/g, "")).toBe("515300");
    await click("Guardar pago", dialog());
    expect(mock.writes()).toHaveLength(1); expect(mock.writes()[0][1]?.method).toBe("PATCH");
    expect(JSON.parse(String(mock.writes()[0][1]!.body))).toMatchObject({ id: payment.id, budgetLineId: budgetLine.id, amount: 515300, accountingMode: "historical-detail", documentIds: [receipt.id] });
  });

  it("counts legacy records without accounting mode as historical detail when checking the available amount", async () => {
    const historic = { ...payment, budgetLineId: budgetLine.id, amount: 400, accountingMode: undefined };
    const mock = api({ budgetLines: [{ ...budgetLine, paid: 1000, workbookPaid: 1000 }], payments: [historic] });
    await renderEmbedded(); await selectValue(accountingSelect, "historical-detail");
    await value('input[name="expense-payment-crc-amount"]', "700"); await click("Guardar pago", dialog());
    expect(dialog().querySelector('[role="alert"]')?.textContent).toContain("600"); expect(mock.writes()).toHaveLength(0);
    await value('input[name="expense-payment-crc-amount"]', "600"); await click("Guardar pago", dialog());
    expect(JSON.parse(String(mock.writes()[0][1]!.body))).toMatchObject({ amount: 600, accountingMode: "historical-detail" });
  });

  it("excludes the edited historical record itself from the amount already detailed", async () => {
    const historic = { ...payment, budgetLineId: budgetLine.id, amount: 400, accountingMode: undefined };
    const mock = api({ budgetLines: [{ ...budgetLine, paid: 400, workbookPaid: 400 }], payments: [historic] });
    await render(); await click("Pagos1"); await click("Editar");
    expect(dialog().querySelector<HTMLSelectElement>(accountingSelect)?.value).toBe("historical-detail");
    expect(dialog().textContent).toContain("400");
    await click("Guardar pago", dialog()); expect(mock.writes()).toHaveLength(1);
    expect(JSON.parse(String(mock.writes()[0][1]!.body))).toMatchObject({ id: payment.id, amount: 400, accountingMode: "historical-detail" });
  });

  it("recomputes the explicit choice when changing budget lines and keeps a fast first payment at zero", async () => {
    api({ budgetLines: [{ ...budgetLine, paid: 1000, workbookPaid: 1000 }, { ...budgetLine, id: "unpaid", item: "Ventanas", paid: 0, workbookPaid: 0 }] });
    await render(); await click("Registrar pago");
    expect(dialog().querySelector<HTMLSelectElement>(accountingSelect)?.value).toBe("ledger");
    const lineSelect = [...dialog().querySelectorAll("select")].find((select) => [...select.options].some((option) => option.value === budgetLine.id))!;
    await act(async () => { lineSelect.value = budgetLine.id; lineSelect.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(dialog().querySelector<HTMLSelectElement>(accountingSelect)?.value).toBe("");
    await selectValue(accountingSelect, "historical-detail");
    await act(async () => { lineSelect.value = "unpaid"; lineSelect.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(dialog().querySelector<HTMLSelectElement>(accountingSelect)?.value).toBe("ledger");
    expect(dialog().querySelector<HTMLOptionElement>(`${accountingSelect} option[value="historical-detail"]`)?.disabled).toBe(true);
    await act(async () => { lineSelect.value = budgetLine.id; lineSelect.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(dialog().querySelector<HTMLSelectElement>(accountingSelect)?.value).toBe("");
  });

  it("subtracts current ledger payments when older budget payloads do not include workbookPaid", async () => {
    const ledger = { ...payment, budgetLineId: budgetLine.id, amount: 515300 };
    api({ budgetLines: [{ ...budgetLine, paid: 1030600 }], payments: [ledger] });
    await renderEmbedded(); await selectValue(accountingSelect, "historical-detail");
    expect(dialog().textContent).toContain("Histórico de Excel disponible por detallar");
    await value('input[name="expense-payment-crc-amount"]', "515300");
    expect(dialog().querySelector('output[aria-label="Pagado después de guardar"]')?.textContent?.replace(/[^\d]/g, "")).toBe("1030600");
    expect(dialog().querySelector<HTMLSelectElement>(accountingSelect)?.value).toBe("historical-detail");
  });

  it("keeps new payment mode when a positive paid total consists entirely of ledger payments", async () => {
    api({ budgetLines: [{ ...budgetLine, paid: 400, workbookPaid: 0 }], payments: [{ ...payment, budgetLineId: budgetLine.id }] });
    await renderEmbedded();
    expect(dialog().querySelector<HTMLSelectElement>(accountingSelect)?.value).toBe("ledger");
    expect(dialog().querySelector<HTMLOptionElement>(`${accountingSelect} option[value="historical-detail"]`)?.disabled).toBe(true);
    expect(dialog().textContent).not.toContain("Histórico de Excel disponible por detallar");
  });
});
