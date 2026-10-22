// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/image", () => ({ default: ({ src, alt }: { src: string; alt: string }) => createElement("img", { src, alt }) }));
import AestheticsWorkspace from "@/app/components/AestheticsWorkspace";

let root: Root | null = null;
let host: HTMLDivElement;
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); });
afterEach(() => { act(() => root?.unmount()); root = null; vi.unstubAllGlobals(); document.body.innerHTML = ""; });

async function render(canEdit = true, mode: "demo" | "real" = "demo", language: "en" | "es" = "en") {
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  await act(async () => { root!.render(createElement(AestheticsWorkspace, { mode, language, canEdit })); });
}
function button(label: string, within: ParentNode = host) {
  const found = [...within.querySelectorAll("button")].find((item) => item.textContent?.includes(label));
  if (!found) throw new Error(`Button not found: ${label}`);
  return found;
}
async function click(label: string, within: ParentNode = host) {
  await act(async () => { button(label, within).click(); });
}
async function choose(select: HTMLSelectElement, value: string) {
  await act(async () => { select.value = value; select.dispatchEvent(new Event("change", { bubbles: true })); });
}
function card(name: string) {
  const found = [...host.querySelectorAll(".aesthetic-grid article")].find((item) => item.querySelector("b")?.textContent === name);
  if (!found) throw new Error(`Card not found: ${name}`);
  return found;
}
async function allFolders() {
  await choose(host.querySelector<HTMLSelectElement>(".aesthetic-gallery-source select")!, "*");
}
async function openRoot(name: string) {
  await click(name, host.querySelector('[aria-label="Aesthetic folders"]')!);
}
async function createSubfolder(name: string) {
  await click("New subfolder");
  const form = host.querySelector<HTMLFormElement>('form[role="dialog"]')!;
  const input = form.querySelector("input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, name);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
}

function carouselNames() {
  return [...host.querySelectorAll(".aesthetic-thumbnail-preview")].map((item) => item.getAttribute("aria-label"));
}

async function renderLegacyCarousel(imageIds: string[]) {
  const payload = {
    folders: [
      { id: "folder-in", name: "Interior", kind: "images", carouselImageIds: imageIds, createdAt: "2026-01-01" },
      { id: "folder-out", name: "Exterior", kind: "images", carouselImageIds: ["photo-one", "missing", "plan-one", "photo-two"], createdAt: "2026-01-01" },
      { id: "folder-plans", name: "Planos", kind: "plans", carouselImageIds: ["plan-one", "photo-one"], createdAt: "2026-01-01" },
    ],
    images: [
      { id: "photo-one", folderId: "folder-in", name: "One.jpg", caption: "", width: 100, height: 100, mediaType: "image", contentType: "image/jpeg", imageUrl: "/one.jpg", thumbnailUrl: "/one.jpg", createdAt: "2026-01-01" },
      { id: "photo-two", folderId: "folder-out", name: "Two.jpg", caption: "", width: 100, height: 100, mediaType: "image", contentType: "image/jpeg", imageUrl: "/two.jpg", thumbnailUrl: "/two.jpg", createdAt: "2026-01-01" },
      { id: "plan-one", folderId: "folder-plans", name: "Plan.pdf", caption: "", width: 100, height: 100, mediaType: "pdf", contentType: "application/pdf", imageUrl: "/plan.pdf", thumbnailUrl: "", createdAt: "2026-01-01" },
    ],
  };
  const patches: Array<{ action: string; id: string; imageIds: string[] }> = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === "PATCH") {
      const body = JSON.parse(String(init.body)); patches.push(body);
      payload.folders.find((folder) => folder.id === body.id)!.carouselImageIds = body.imageIds;
      return new Response(JSON.stringify({ ok: true }));
    }
    return new Response(JSON.stringify(payload));
  }));
  await render(true, "real");
  await vi.waitFor(() => expect(host.querySelector(".aesthetic-folder-toolbar h3")?.textContent).toBe("Interior"));
  return { payload, patches };
}

describe("aesthetic workspace folders and carousels", () => {
  it("downloads the selected folder for viewers regardless of gallery filter or cross-folder carousel photos, and releases the blob URL", async () => {
    const payload = {
      folders: [
        { id: "interior", name: "Interiór", kind: "images", carouselImageIds: ["outside"], createdAt: "2026-01-01" },
        { id: "kitchen", name: "Cocina", kind: "images", parentId: "interior", carouselImageIds: [], createdAt: "2026-01-01" },
        { id: "exterior", name: "Exterior", kind: "images", carouselImageIds: [], createdAt: "2026-01-01" },
        { id: "plans", name: "Planos", kind: "plans", carouselImageIds: [], createdAt: "2026-01-01" },
      ],
      images: [
        { id: "kitchen-photo", folderId: "kitchen", name: "Cocina.jpg" },
        { id: "outside", folderId: "exterior", name: "Exterior.jpg" },
      ].map((image) => ({ ...image, caption: "", width: 100, height: 100, mediaType: "image", contentType: "image/jpeg", imageUrl: "/one.jpg", thumbnailUrl: "/one.jpg", createdAt: "2026-01-01" })),
    };
    const requests: string[] = [];
    const createObjectURL = vi.fn(() => "blob:archive"); const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", Object.assign(class extends URL {}, { createObjectURL, revokeObjectURL }));
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (!url.includes("/archive?")) return new Response(JSON.stringify(payload));
      requests.push(url);
      return new Response(new Uint8Array([80, 75, 3, 4]), { headers: { "Content-Type": "application/zip", "Content-Disposition": "attachment; filename=\"imagenes.zip\"; filename*=UTF-8''Interi%C3%B3r-imagenes.zip" } });
    }));
    const downloads: { filename: string; href: string }[] = [];
    const anchor = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { downloads.push({ filename: this.download, href: this.href }); });
    await render(false, "real", "es");
    await vi.waitFor(() => expect(host.querySelector(".aesthetic-folder-toolbar h3")?.textContent).toBe("Interiór"));
    await choose(host.querySelector<HTMLSelectElement>(".aesthetic-gallery-source select")!, "exterior");
    expect(host.querySelector("#aesthetic-archive-help")?.textContent).toContain("esta carpeta y sus subcarpetas");
    expect(button("Descargar imágenes").disabled).toBe(false);
    await click("Descargar imágenes");
    expect(requests).toEqual(["/api/aesthetics/archive?folderId=interior"]);
    expect(downloads).toEqual([{ filename: "Interiór-imagenes.zip", href: "blob:archive" }]);
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(host.querySelector('a[download]')).toBeNull();
    expect(revokeObjectURL).not.toHaveBeenCalled();
    await choose(host.querySelector<HTMLSelectElement>(".aesthetic-mobile-folder-picker select")!, "plans");
    expect([...host.querySelectorAll("button")].some((item) => item.textContent?.includes("Descargar imágenes"))).toBe(false);
    act(() => root?.unmount()); root = null;
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:archive");
    anchor.mockRestore();
  });

  it("prevents duplicate archive requests and shows API errors without creating a download", async () => {
    await renderLegacyCarousel(["photo-one"]);
    const createObjectURL = vi.fn();
    vi.stubGlobal("URL", Object.assign(class extends URL {}, { createObjectURL, revokeObjectURL: vi.fn() }));
    let finish: (response: Response) => void = () => {};
    const request = new Promise<Response>((resolve) => { finish = resolve; });
    const fetchArchive = vi.fn(() => request); vi.stubGlobal("fetch", fetchArchive);
    await act(async () => { button("Download images").click(); button("Download images").click(); });
    expect(button("Preparing ZIP…").disabled).toBe(true);
    expect(fetchArchive).toHaveBeenCalledTimes(1);
    await act(async () => { finish(new Response(JSON.stringify({ error: "El ZIP admite hasta 100 MB de imágenes." }), { status: 413 })); });
    expect(button("Download images").disabled).toBe(false);
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("El ZIP admite hasta 100 MB de imágenes.");
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it("releases a completed ZIP object URL after the browser acquisition delay", async () => {
    await renderLegacyCarousel(["photo-one"]);
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", Object.assign(class extends URL {}, { createObjectURL: vi.fn(() => "blob:completed"), revokeObjectURL }));
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array([80, 75]), { headers: { "Content-Type": "application/zip", "Content-Disposition": 'attachment; filename="Interior.zip"' } })));
    const anchor = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    vi.useFakeTimers();
    try {
      await click("Download images");
      expect(revokeObjectURL).not.toHaveBeenCalled();
      await act(async () => { vi.advanceTimersByTime(30_000); });
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:completed");
      act(() => root?.unmount()); root = null;
      expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); anchor.mockRestore(); }
  });

  it("aborts an unfinished archive request when leaving the section", async () => {
    await renderLegacyCarousel(["photo-one"]);
    const createObjectURL = vi.fn();
    vi.stubGlobal("URL", Object.assign(class extends URL {}, { createObjectURL, revokeObjectURL: vi.fn() }));
    let finish: (response: Response) => void = () => {};
    const request = new Promise<Response>((resolve) => { finish = resolve; });
    const fetchArchive = vi.fn<(url: string, options: RequestInit) => Promise<Response>>(() => request); vi.stubGlobal("fetch", fetchArchive);
    await click("Download images");
    const signal = fetchArchive.mock.calls[0][1].signal!;
    act(() => root?.unmount()); root = null;
    expect(signal.aborted).toBe(true);
    await act(async () => { finish(new Response(new Uint8Array([80, 75]), { headers: { "Content-Type": "application/zip" } })); });
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it("creates multiple sibling folders and deeper subfolders, with breadcrumb navigation", async () => {
    await render();
    await createSubfolder("Cocina");
    expect(host.querySelector(".aesthetic-breadcrumbs")?.textContent).toBe("Interior / Cocina");
    await openRoot("Interior");
    await createSubfolder("Baños");
    await createSubfolder("Principal");
    expect(host.querySelector(".aesthetic-breadcrumbs")?.textContent).toBe("Interior / Baños / Principal");
    expect([...host.querySelectorAll(".aesthetic-gallery-source option")].some((option) => option.textContent === "Interior / Cocina")).toBe(true);
    await openRoot("Interior");
    expect(host.querySelector('[aria-label="Aesthetic folders"]')?.textContent).toContain("Cocina");
    expect(host.querySelector('[aria-label="Aesthetic folders"]')?.textContent).toContain("Baños");
    expect(host.querySelectorAll('[aria-label="Aesthetic folders"] > button:not(.nested)')).toHaveLength(3);
    expect(button("Delete", host.querySelector(".aesthetic-folder-toolbar")!).disabled).toBe(true);
  });

  it("combines photos from different folders without switching the carousel or duplicating originals", async () => {
    await render();
    await allFolders();
    await click("Show in carousel", card("Terrace.jpg"));
    expect(host.querySelector(".aesthetic-folder-toolbar h3")?.textContent).toBe("Interior");
    expect(carouselNames()).toEqual(["Show Main living room.jpg", "Show Kitchen.jpg", "Show Bathroom.jpg", "Show Terrace.jpg"]);
    expect(host.querySelectorAll(".aesthetic-grid article")).toHaveLength(4);
    await click("Remove from carousel · Interior", card("Terrace.jpg"));
    expect(carouselNames()).not.toContain("Show Terrace.jpg");
    expect(card("Terrace.jpg").querySelector(".aesthetic-source-path")?.textContent).toBe("Exterior");
    await openRoot("Exterior");
    expect(carouselNames()).toEqual(["Show Terrace.jpg"]);
  });

  it("retains carousel membership when a selected image moves folders", async () => {
    await render();
    await choose(card("Main living room.jpg").querySelector<HTMLSelectElement>("select")!, "demo-exterior");
    expect(carouselNames()).toContain("Show Main living room.jpg");
    await allFolders();
    expect(card("Main living room.jpg").querySelector(".aesthetic-source-path")?.textContent).toBe("Exterior");
    await openRoot("Exterior");
    expect(carouselNames()).toEqual(["Show Terrace.jpg"]);
  });

  it("deletes an image from every carousel but only after confirmation", async () => {
    await render(); await allFolders(); await click("Show in carousel", card("Terrace.jpg"));
    await act(async () => { host.querySelector<HTMLButtonElement>('[aria-label="Delete Terrace.jpg"]')!.click(); });
    expect(carouselNames()).toContain("Show Terrace.jpg");
    await click("Delete", host.querySelector('[role="alertdialog"]')!);
    expect(carouselNames()).not.toContain("Show Terrace.jpg");
    await openRoot("Exterior");
    expect(carouselNames()).toEqual([]);
    expect(host.querySelectorAll(".aesthetic-grid article")).toHaveLength(0);
  });

  it("allows an empty carousel without deleting its gallery images", async () => {
    await render();
    for (const name of ["Main living room.jpg", "Kitchen.jpg", "Bathroom.jpg"]) {
      await click("Remove from carousel · Interior", card(name));
    }
    expect(carouselNames()).toEqual([]);
    expect(host.querySelectorAll(".aesthetic-grid article")).toHaveLength(3);
  });

  it("does not expose editing controls to read-only viewers", async () => {
    await render(false); await allFolders();
    expect(host.querySelectorAll(".aesthetic-image-actions")).toHaveLength(0);
    expect(host.querySelectorAll(".aesthetic-thumbnail-order")).toHaveLength(0);
    expect([...host.querySelectorAll("button")].some((item) => item.textContent?.includes("New folder") || item.textContent?.includes("New subfolder"))).toBe(false);
    expect(host.querySelectorAll(".aesthetic-grid article")).toHaveLength(4);
  });

  it("shows unclassified legacy imagery in the gallery, carousel and read-only viewer", async () => {
    await render(false);
    expect(card("Main living room.jpg").querySelector(".aesthetic-classification")?.textContent).toBe("Unclassified");
    expect(host.querySelector(".aesthetic-stage .aesthetic-classification")?.textContent).toBe("Unclassified");
    await act(async () => { card("Main living room.jpg").querySelector<HTMLButtonElement>(".aesthetic-grid-image")!.click(); });
    const viewer = host.querySelector(".aesthetic-viewer")!;
    expect(viewer.querySelector(".aesthetic-classification")?.textContent).toBe("Unclassified");
    expect(viewer.querySelector(".aesthetic-classification-control")).toBeNull();
  });

  it("focuses the close control and returns focus to the tapped photo without scrolling", async () => {
    await render(false);
    const opener = card("Main living room.jpg").querySelector<HTMLButtonElement>(".aesthetic-grid-image")!;
    const focus = vi.spyOn(opener, "focus");
    const overflow = document.body.style.overflow;
    // Touch clicks need not focus the original button before opening the viewer.
    expect(document.activeElement).not.toBe(opener);
    await act(async () => { opener.click(); });
    const close = host.querySelector<HTMLButtonElement>('.aesthetic-viewer [aria-label="Close image"]')!;
    expect(document.activeElement).toBe(close);
    expect(document.body.style.overflow).toBe("hidden");
    await act(async () => { close.click(); });
    expect(document.activeElement).toBe(opener);
    expect(focus).toHaveBeenLastCalledWith({ preventScroll: true });
    expect(document.body.style.overflow).toBe(overflow);
    focus.mockRestore();
  });

  it("starts the carousel manually and pauses playback when browsing or opening a photo", async () => {
    await render(false);
    expect(button("Play").getAttribute("aria-pressed")).toBe("false");
    await click("Play");
    expect(button("Pause").getAttribute("aria-pressed")).toBe("true");
    await act(async () => host.querySelector<HTMLButtonElement>('.aesthetic-arrow.next')!.click());
    expect(button("Play").getAttribute("aria-pressed")).toBe("false");
    expect(host.querySelector(".aesthetic-stage b")?.textContent).toBe("Kitchen.jpg");
    await click("Play");
    await act(async () => host.querySelector<HTMLButtonElement>('.aesthetic-stage')!.click());
    expect(button("Play").getAttribute("aria-pressed")).toBe("false");
  });

  it("swipes carousel photos without opening the viewer through a synthesized click", async () => {
    await render(false);
    const stage = host.querySelector<HTMLButtonElement>(".aesthetic-stage")!;
    for (const [type, points] of [["touchstart", [[200, 100]]], ["touchmove", [[90, 104]]], ["touchend", []]] as const) {
      const event = new Event(type, { bubbles: true, cancelable: true });
      const touches = points.map(([clientX, clientY]) => ({ identifier: 0, clientX, clientY }));
      Object.defineProperties(event, { touches: { value: touches }, changedTouches: { value: type === "touchend" ? [{ identifier: 0, clientX: 90, clientY: 104 }] : touches } });
      await act(async () => stage.dispatchEvent(event));
      expect(event.defaultPrevented).toBe(false);
    }
    expect(host.querySelector(".aesthetic-stage b")?.textContent).toBe("Kitchen.jpg");
    await act(async () => stage.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 })));
    expect(host.querySelector(".aesthetic-viewer")).toBeNull();
    await act(async () => stage.click());
    expect(host.querySelector('.aesthetic-viewer [role="dialog"]')?.getAttribute("aria-label")).toBe("Kitchen.jpg");
  });

  it("browses the original photo sequence while keeping the body locked and restoring the original opener once", async () => {
    await renderLegacyCarousel(["photo-one", "photo-two", "plan-one"]);
    const opener = host.querySelector<HTMLButtonElement>(".aesthetic-stage")!;
    const focus = vi.spyOn(opener, "focus");
    await act(async () => opener.click());
    const close = host.querySelector<HTMLButtonElement>('.aesthetic-viewer .close')!;
    await act(async () => host.querySelector<HTMLButtonElement>('.aesthetic-viewer-arrow.next')!.click());
    expect(host.querySelector('.aesthetic-viewer [role="dialog"]')?.getAttribute("aria-label")).toBe("Two.jpg");
    expect(host.querySelector('.aesthetic-viewer-count')?.textContent).toBe("2 / 2");
    expect(document.body.style.overflow).toBe("hidden");
    expect(focus).not.toHaveBeenCalled();
    await act(async () => close.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true })));
    expect(host.querySelector('.aesthetic-viewer [role="dialog"]')?.getAttribute("aria-label")).toBe("One.jpg");
    await act(async () => close.click());
    expect(focus).toHaveBeenCalledTimes(1);
    expect(focus).toHaveBeenLastCalledWith({ preventScroll: true });
    expect(document.body.style.overflow).not.toBe("hidden");
    focus.mockRestore();
    await act(async () => card("One.jpg").querySelector<HTMLButtonElement>(".aesthetic-grid-image")!.click());
    expect(host.querySelector('.aesthetic-viewer-arrow')).toBeNull();
    await act(async () => host.querySelector<HTMLButtonElement>('.aesthetic-viewer .close')!.click());
    await allFolders();
    await act(async () => card("One.jpg").querySelector<HTMLButtonElement>(".aesthetic-grid-image")!.click());
    expect(host.querySelector('.aesthetic-viewer-count')?.textContent).toBe("1 / 2");
    expect(host.querySelector('.aesthetic-viewer iframe')).toBeNull();
  });

  it("leaves native arrow keys on classification selects available without changing photos", async () => {
    await render();
    await act(async () => host.querySelector<HTMLButtonElement>(".aesthetic-stage")!.click());
    const select = host.querySelector<HTMLSelectElement>('.aesthetic-classification-control select')!;
    const event = new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true });
    await act(async () => select.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(false);
    expect(host.querySelector('.aesthetic-viewer [role="dialog"]')?.getAttribute("aria-label")).toBe("Main living room.jpg");
  });

  it("contains keyboard focus in the image viewer and closes it with Escape", async () => {
    await render();
    const opener = card("Main living room.jpg").querySelector<HTMLButtonElement>(".aesthetic-grid-image")!;
    await act(async () => { opener.click(); });
    const close = host.querySelector<HTMLButtonElement>('.aesthetic-viewer [aria-label="Close image"]')!;
    const last = host.querySelector<HTMLSelectElement>('.aesthetic-viewer [aria-label="Classify Main living room.jpg"]')!;
    await act(async () => { close.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true })); });
    expect(document.activeElement).toBe(last);
    await act(async () => { last.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true })); });
    expect(document.activeElement).toBe(close);
    await act(async () => { opener.focus(); });
    expect(document.activeElement).toBe(close);
    await act(async () => { close.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); });
    expect(host.querySelector(".aesthetic-viewer")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("lets nested image notes own focus and returns to the viewer before closing the photo", async () => {
    await render(false);
    const opener = card("Main living room.jpg").querySelector<HTMLButtonElement>(".aesthetic-grid-image")!;
    await act(async () => { opener.click(); });
    const notes = host.querySelector<HTMLButtonElement>('.aesthetic-viewer [aria-label="Notes for Main living room.jpg"]')!;
    await act(async () => { notes.click(); });
    const notesClose = button("Close", host.querySelector(".aesthetic-notes-dialog")!);
    expect(document.activeElement).toBe(notesClose);
    expect(host.querySelector(".aesthetic-viewer")?.hasAttribute("inert")).toBe(true);
    await act(async () => { notesClose.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); });
    expect(host.querySelector(".aesthetic-notes-dialog")).toBeNull();
    expect(host.querySelector(".aesthetic-viewer")).not.toBeNull();
    expect(document.activeElement).toBe(notes);
    expect(document.body.style.overflow).toBe("hidden");
    await act(async () => { notes.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); });
    expect(host.querySelector(".aesthetic-viewer")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it.each(["", "auto"])("restores the original body overflow %j when the section unmounts with viewer and notes open", async (overflow) => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = overflow;
    await render(false);
    const opener = card("Main living room.jpg").querySelector<HTMLButtonElement>(".aesthetic-grid-image")!;
    await act(async () => { opener.click(); });
    const notes = host.querySelector<HTMLButtonElement>('.aesthetic-viewer [aria-label="Notes for Main living room.jpg"]')!;
    await act(async () => { notes.click(); });
    expect(document.body.style.overflow).toBe("hidden");
    expect(host.querySelector(".aesthetic-notes-dialog")?.contains(document.activeElement)).toBe(true);
    const detachedFocus = vi.spyOn(notes, "focus");
    act(() => root!.unmount()); root = null;
    expect(document.body.style.overflow).toBe(overflow);
    expect(document.activeElement).toBe(document.body);
    expect(detachedFocus).not.toHaveBeenCalled();
    detachedFocus.mockRestore();
    document.body.style.overflow = previousOverflow;
  });

  it("keeps standalone image notes scroll locked and restores overflow and focus on close or section unmount", async () => {
    const overflow = document.body.style.overflow;
    await render(false);
    const notes = card("Main living room.jpg").querySelector<HTMLButtonElement>('[aria-label="Notes for Main living room.jpg"]')!;
    await act(async () => { notes.click(); });
    expect(host.querySelector(".aesthetic-viewer")).toBeNull();
    expect(document.body.style.overflow).toBe("hidden");
    await click("Close", host.querySelector(".aesthetic-notes-dialog")!);
    expect(document.body.style.overflow).toBe(overflow);
    expect(document.activeElement).toBe(notes);
    await act(async () => { notes.click(); });
    expect(document.body.style.overflow).toBe("hidden");
    act(() => root!.unmount()); root = null;
    expect(document.body.style.overflow).toBe(overflow);
    expect(document.activeElement).toBe(document.body);
  });

  it("lets editors classify imagery in the viewer while preserving notes and carousel membership", async () => {
    await render();
    const originalCarousel = carouselNames();
    await act(async () => { card("Main living room.jpg").querySelector<HTMLButtonElement>(".aesthetic-grid-image")!.click(); });
    for (const [value, label] of [["planned", "Planned design"], ["inspiration", "Inspiration reference"], ["unclassified", "Unclassified"]]) {
      await choose(host.querySelector<HTMLSelectElement>('.aesthetic-viewer [aria-label="Classify Main living room.jpg"]')!, value);
      expect(host.querySelector(".aesthetic-viewer .aesthetic-classification")?.textContent).toBe(label);
      expect(host.querySelector(".aesthetic-stage .aesthetic-classification")?.textContent).toBe(label);
      expect(card("Main living room.jpg").querySelector(".aesthetic-classification")?.textContent).toBe(label);
      expect(carouselNames()).toEqual(originalCarousel);
    }
    await act(async () => { host.querySelector<HTMLButtonElement>('.aesthetic-viewer [aria-label="Notes for Main living room.jpg"]')!.click(); });
    expect(host.querySelector<HTMLTextAreaElement>(".aesthetic-notes-dialog textarea")!.value).toContain("Keep natural light coming in.");
  });

  it("shows Spanish classification options and visible labels", async () => {
    await render(true, "demo", "es");
    await act(async () => { card("Sala principal.jpg").querySelector<HTMLButtonElement>(".aesthetic-grid-image")!.click(); });
    const selector = host.querySelector<HTMLSelectElement>('.aesthetic-viewer [aria-label="Clasificar Sala principal.jpg"]')!;
    expect([...selector.options].map((option) => option.text)).toEqual(["Sin clasificar", "Diseño previsto", "Referencia de inspiración"]);
    await choose(selector, "inspiration");
    expect(card("Sala principal.jpg").querySelector(".aesthetic-classification")?.textContent).toBe("Referencia de inspiración");
  });

  it("keeps image classifications and editing controls out of plan PDF previews", async () => {
    await renderLegacyCarousel(["photo-one"]);
    await openRoot("Planos");
    await act(async () => { card("Plan.pdf").querySelector<HTMLButtonElement>(".aesthetic-grid-image")!.click(); });
    expect(host.querySelectorAll(".aesthetic-classification")).toHaveLength(0);
    expect(host.querySelector(".aesthetic-classification-control")).toBeNull();
    expect(host.querySelector(".aesthetic-viewer iframe")?.getAttribute("title")).toBe("Plan.pdf");
  });

  it("persists a real classification request and keeps saved labels after a failed change", async () => {
    const payload = {
      folders: [{ id: "folder-in", name: "Interior", kind: "images", carouselImageIds: ["photo-one"], createdAt: "2026-01-01" }],
      images: [{ id: "photo-one", folderId: "folder-in", name: "One.jpg", caption: "A house", notes: "Keep notes", classification: "unclassified", width: 100, height: 100, mediaType: "image", contentType: "image/jpeg", imageUrl: "/one.jpg", thumbnailUrl: "/one.jpg", createdAt: "2026-01-01" }],
    };
    const patches: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        const body = JSON.parse(String(init.body)); patches.push(body);
        if (body.classification === "inspiration") return new Response(JSON.stringify({ error: "Classification could not be saved" }), { status: 500 });
        payload.images[0].classification = body.classification;
        return new Response(JSON.stringify({ image: payload.images[0] }));
      }
      return new Response(JSON.stringify(payload));
    }));
    await render(true, "real");
    await vi.waitFor(() => expect(host.querySelector(".aesthetic-stage .aesthetic-classification")?.textContent).toBe("Unclassified"));
    await act(async () => { card("One.jpg").querySelector<HTMLButtonElement>(".aesthetic-grid-image")!.click(); });
    await choose(host.querySelector<HTMLSelectElement>('.aesthetic-viewer [aria-label="Classify One.jpg"]')!, "planned");
    expect(patches).toEqual([{ action: "classification", id: "photo-one", classification: "planned" }]);
    expect(card("One.jpg").querySelector(".aesthetic-classification")?.textContent).toBe("Planned design");
    await choose(host.querySelector<HTMLSelectElement>('.aesthetic-viewer [aria-label="Classify One.jpg"]')!, "inspiration");
    expect(host.querySelector(".aesthetic-viewer [role=alert]")?.textContent).toBe("Classification could not be saved");
    expect(host.querySelector<HTMLSelectElement>('.aesthetic-viewer [aria-label="Classify One.jpg"]')!.value).toBe("planned");
    expect(payload.images[0].notes).toBe("Keep notes");
    expect(carouselNames()).toEqual(["Show One.jpg"]);
    act(() => root?.unmount()); root = null;
    await render(false, "real");
    await vi.waitFor(() => expect(card("One.jpg").querySelector(".aesthetic-classification")?.textContent).toBe("Planned design"));
    expect(host.querySelector(".aesthetic-classification-control")).toBeNull();
  });

  it("creates PDF subfolders while keeping the Planos root protected", async () => {
    await render();
    await openRoot("Plans");
    expect(button("New subfolder").disabled).toBe(false);
    expect([...host.querySelectorAll(".aesthetic-folder-actions button")].some((item) => /Rename|Delete/.test(item.textContent || ""))).toBe(false);
    await createSubfolder("Revisions");
    expect(host.querySelector(".aesthetic-breadcrumbs")?.textContent).toBe("Plans / Revisions");
    expect(button("Add PDFs").disabled).toBe(false);
    expect(button("Rename").disabled).toBe(false);
    expect(button("Delete", host.querySelector(".aesthetic-folder-actions")!).disabled).toBe(false);
    expect([...host.querySelectorAll(".aesthetic-gallery-source option")].map((item) => item.textContent)).toEqual(["All plan folders", "Plans", "Plans / Revisions"]);
    await click("Plans", host.querySelector(".aesthetic-breadcrumbs")!);
    expect(host.querySelector(".aesthetic-folder-toolbar h3")?.textContent).toBe("Plans");
  });

  it("inherits image kind for an image subfolder named Planos", async () => {
    await render();
    await createSubfolder("Planos");
    expect(host.querySelector(".aesthetic-breadcrumbs")?.textContent).toBe("Interior / Planos");
    expect(button("Add images").disabled).toBe(false);
    expect(button("Choose carousel photos").disabled).toBe(false);
  });

  it("adds uploaded files to the gallery without adding them to a curated carousel", async () => {
    vi.stubGlobal("URL", Object.assign(class extends URL {}, { createObjectURL: vi.fn(() => "/uploaded.png") }));
    await render();
    const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, "files", { value: [new File(["image"], "Upload.png", { type: "image/png" })], configurable: true });
    await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(card("Upload.png")).toBeDefined();
    expect(carouselNames()).toEqual(["Show Main living room.jpg", "Show Kitchen.jpg", "Show Bathroom.jpg"]);
    await click("Show in carousel · Interior", card("Upload.png"));
    expect(carouselNames()).toContain("Show Upload.png");
  });

  it("allows adding to a legacy carousel with 30 stored references and cleans missing or incompatible files", async () => {
    const imageIds = ["photo-one", "plan-one", ...Array.from({ length: 28 }, (_, index) => `missing-${index}`)];
    const { patches } = await renderLegacyCarousel(imageIds);
    expect(carouselNames()).toEqual(["Show One.jpg"]);
    await allFolders();
    expect(button("Show in carousel · Interior", card("Two.jpg")).disabled).toBe(false);
    expect(card("One.jpg").textContent).not.toContain("Remove from carousel · Planos");
    await click("Choose carousel photos");
    const pickerLabel = [...host.querySelectorAll(".aesthetic-picker-grid label")].find((item) => item.textContent?.includes("Two.jpg"))!;
    expect(pickerLabel.querySelector<HTMLInputElement>('input[type="checkbox"]')!.disabled).toBe(false);
    await click("Show in carousel · Interior", card("Two.jpg"));
    expect(patches).toEqual([{ action: "carousel", id: "folder-in", imageIds: ["photo-one", "photo-two"] }]);
    expect(carouselNames()).toEqual(["Show One.jpg", "Show Two.jpg"]);
  });

  it("removes a photo from the named carousel and cleans only that target's stale references", async () => {
    const original = ["photo-one", "missing", "plan-one", "photo-two"];
    const { payload, patches } = await renderLegacyCarousel(original);
    await click("Remove from carousel · Exterior", card("One.jpg"));
    expect(patches).toEqual([{ action: "carousel", id: "folder-out", imageIds: ["photo-two"] }]);
    expect(payload.folders[0].carouselImageIds).toEqual(original);
    expect(carouselNames()).toEqual(["Show One.jpg", "Show Two.jpg"]);
    expect(card("One.jpg").textContent).not.toContain("Remove from carousel · Exterior");
  });

  it("reorders the displayed legacy carousel sequence while dropping hidden stale references", async () => {
    const { patches } = await renderLegacyCarousel(["photo-one", "missing", "plan-one", "photo-two"]);
    await act(async () => { host.querySelector<HTMLButtonElement>('[aria-label="Move Two.jpg left"]')!.click(); });
    expect(patches).toEqual([{ action: "carousel", id: "folder-in", imageIds: ["photo-two", "photo-one"] }]);
    expect(carouselNames()).toEqual(["Show Two.jpg", "Show One.jpg"]);
  });

  it("persists a cross-folder selection and restores it on a fresh mount", async () => {
    const payload = {
      folders: [
        { id: "folder-in", name: "Interior", kind: "images", parentId: null, carouselImageIds: ["photo-one"], createdAt: "2026-01-01" },
        { id: "folder-out", name: "Exterior", kind: "images", parentId: null, carouselImageIds: [], createdAt: "2026-01-01" },
      ],
      images: [
        { id: "photo-one", folderId: "folder-in", name: "One.jpg", caption: "", width: 100, height: 100, mediaType: "image", contentType: "image/jpeg", imageUrl: "/one.jpg", thumbnailUrl: "/one.jpg", createdAt: "2026-01-01" },
        { id: "photo-two", folderId: "folder-out", name: "Two.jpg", caption: "", width: 100, height: 100, mediaType: "image", contentType: "image/jpeg", imageUrl: "/two.jpg", thumbnailUrl: "/two.jpg", createdAt: "2026-01-01" },
      ],
    };
    const patches: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        const body = JSON.parse(String(init.body)); patches.push(body);
        payload.folders.find((folder) => folder.id === body.id)!.carouselImageIds = body.imageIds;
        return new Response(JSON.stringify({ ok: true }));
      }
      return new Response(JSON.stringify(payload));
    }));
    await render(true, "real");
    await vi.waitFor(() => expect(carouselNames()).toEqual(["Show One.jpg"]));
    await allFolders(); await click("Show in carousel", card("Two.jpg"));
    expect(patches).toEqual([{ action: "carousel", id: "folder-in", imageIds: ["photo-one", "photo-two"] }]);
    expect(payload.images[1].folderId).toBe("folder-out");
    act(() => root?.unmount()); root = null;
    await render(true, "real");
    await vi.waitFor(() => expect(carouselNames()).toEqual(["Show One.jpg", "Show Two.jpg"]));
  });
});
