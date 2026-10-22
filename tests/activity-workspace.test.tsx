// @vitest-environment jsdom
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ActivityWorkspace, { ActivitySummaryCard } from "@/app/components/ActivityWorkspace";
import type { ActivityEvent } from "@/lib/activity-types";

let root: Root, container: HTMLDivElement;
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  fetchMock = vi.fn(async () => Response.json({ events: [], nextCursor: null }));
  vi.stubGlobal("fetch", fetchMock);
  container = document.createElement("div"); document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove(); vi.unstubAllGlobals();
});
async function render(mode: "demo" | "real", language: "en" | "es", summary = true) {
  await act(async () => {
    root.render(createElement(Fragment, null,
      createElement(ActivityWorkspace, { mode, language, onNavigate: vi.fn() }),
      summary && createElement(ActivitySummaryCard, { mode, language, onNavigate: vi.fn() }),
    ));
    await new Promise(resolve => setTimeout(resolve, 1));
  });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 1)); });
}
const stored: ActivityEvent = {
  id: "private", sequence: 1, category: "document", action: "document.uploaded", source: "user",
  actor: { uid: "member", name: "María", role: "editor" },
  target: { type: "document", id: "file", label: "Contrato firmado.pdf", section: "documents", exists: true },
  summaryParams: {}, changes: [{ field: "notes", before: "Nota original", after: "Texto privado", format: "text" }],
  changeCount: 1, occurredAt: "2026-09-12T12:00:00Z", visibility: { requiredTabs: ["documents"] },
  integrity: "verified", hasDetails: false,
};

describe("activity language display", () => {
  it("retains each historical event's denomination across language changes", async () => {
    const events: ActivityEvent[] = [{ ...stored, changes: [
      { field: "amount", before: 0, after: 12.75, format: "currency_usd" },
      { field: "amount", before: 0, after: 7500, format: "currency_crc" },
    ], changeCount: 2 }];
    fetchMock.mockImplementation(async () => Response.json({ events, nextCursor: null }));
    await render("real", "en", false);
    expect(container.textContent).toContain("$12.75"); expect(container.textContent).toContain(new Intl.NumberFormat("en-US", { style: "currency", currency: "CRC", maximumFractionDigits: 0 }).format(7500));
    await render("real", "es", false);
    expect(container.textContent).toContain(new Intl.NumberFormat("es-CR", { style: "currency", currency: "USD" }).format(12.75));
    expect(events[0].changes[1].format).toBe("currency_crc");
  });

  it("changes both demo timeline and overview summary in place, including open details and stable dates", async () => {
    await render("demo", "en");
    expect(container.querySelector(".activity-summary-card")?.textContent).toContain("Kitchen_invoice.pdf");
    expect(container.querySelector(".activity-timeline")?.textContent).toContain("Kitchen cabinetry");
    expect(container.querySelector(".activity-change-list")?.textContent).toContain("Receipt");
    expect(container.textContent).toContain("Budget · Cabinetry · Paid price");
    expect(container.textContent).toContain("Deleted");
    const firstCard = container.querySelector(".activity-entry")!;
    const details = firstCard.querySelector("details")!;
    await act(async () => { details.open = true; });
    const category = container.querySelector<HTMLSelectElement>(".activity-filters select")!;
    await act(async () => { category.value = "expense"; category.dispatchEvent(new Event("change", { bubbles: true })); });
    const firstTime = firstCard.querySelector("time")?.textContent;

    await render("demo", "es");
    expect(container.querySelector(".activity-entry")).toBe(firstCard);
    expect(details.open).toBe(true);
    expect(category.value).toBe("expense");
    expect(container.querySelector(".activity-summary-card")?.textContent).toContain("Factura_cocina.pdf");
    expect(container.querySelector(".activity-timeline")?.textContent).toContain("Mobiliario de cocina");
    expect(firstCard.querySelector(".activity-change-list")?.textContent).toContain("Comprobante");
    expect(firstCard.querySelector(".activity-change-list")?.textContent).not.toContain("Kitchen_invoice.pdf");
    expect(container.textContent).toContain("Presupuesto · Mobiliario · Precio pagado");
    expect(container.textContent).toContain("Eliminado");

    await render("demo", "en");
    expect(firstCard.querySelector("time")?.textContent).toBe(firstTime);
    expect(firstCard.querySelector(".activity-change-list")?.textContent).toContain("Kitchen_invoice.pdf");
    expect(container.textContent).toContain("Carlos");
    expect(container.textContent).toContain("Ana");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps private event labels and values verbatim while translating interface copy", async () => {
    const before = JSON.stringify(stored);
    fetchMock.mockImplementation(async () => Response.json({ events: [stored], nextCursor: null }));
    await render("real", "en");
    expect(container.textContent).toContain("María uploaded “Contrato firmado.pdf”");
    expect(container.textContent).toContain("Notes");
    expect(container.textContent).toContain("Texto privado");
    await render("real", "es");
    expect(container.textContent).toContain("María subió “Contrato firmado.pdf”");
    expect(container.textContent).toContain("Notas");
    expect(container.textContent).toContain("Texto privado");
    expect(JSON.stringify(stored)).toBe(before);
    expect(fetchMock.mock.calls.every(([, options]) => options?.method === undefined || options.method === "GET")).toBe(true);
  });

  it("retains loaded private change details across language switches", async () => {
    const extended = { ...stored, hasDetails: true, changeCount: 2 };
    const full = [...stored.changes, { field: "receipt", before: null, after: "Comprobante personal.pdf", format: "text" }];
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => String(input).endsWith("/private")
      ? Response.json({ details: full }) : Response.json({ events: [extended], nextCursor: null }));
    await render("real", "en", false);
    const details = container.querySelector<HTMLDetailsElement>(".activity-details")!;
    await act(async () => { details.open = true; details.dispatchEvent(new Event("toggle", { bubbles: true })); });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 1)); });
    expect(container.textContent).toContain("Comprobante personal.pdf");
    expect(container.textContent).toContain("Receipt");
    await render("real", "es", false);
    expect(details.open).toBe(true);
    expect(container.textContent).toContain("Comprobante personal.pdf");
    expect(container.textContent).toContain("Comprobante");
    expect(fetchMock.mock.calls.filter(([input]) => String(input).endsWith("/private"))).toHaveLength(1);
    expect(full[1].field).toBe("receipt");
  });

});
