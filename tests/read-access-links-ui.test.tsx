// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import ReadAccessLinks from "@/app/components/ReadAccessLinks";
import { DEFAULT_MEMBER_PERMISSIONS, type MemberPermissions } from "@/lib/project";

let root: Root | null = null;
let container: HTMLDivElement;
afterEach(() => { act(() => root?.unmount()); root = null; document.body.innerHTML = ""; vi.unstubAllGlobals(); });

const record = (permissions: MemberPermissions = { ...DEFAULT_MEMBER_PERMISSIONS }, extra: Record<string, unknown> = {}) => ({ id: "hashed-link-id", projectId: "sample-house", label: "Revisión", role: "viewer", status: "active", permissions, folderAccess: { mode: "all", folderIds: [], allowUnfiled: true }, createdAt: "2026-10-04T00:00:00Z", expiresAt: "2026-10-18T00:00:00Z", createdBy: "owner@example.test", redemptionCount: 2, ...extra });
async function mount(existing = false, failure = "", options: { language?: "en" | "es"; link?: Record<string, unknown>; onAccessChanged?: () => void | Promise<unknown> } = {}) {
  const actions: Array<Record<string, unknown>> = [];
  const savedLinks = new Map<string, ReturnType<typeof record>>();
  if (existing) savedLinks.set("hashed-link-id", record(undefined, options.link));
  vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (!init?.method) return new Response(JSON.stringify({ links: [...savedLinks.values()] }));
    const body = JSON.parse(String(init.body)); actions.push({ method: init.method, ...body });
    if (failure) return new Response(JSON.stringify({ error: failure }), { status: 503 });
    const id = init.method === "POST" ? "new-created-link-id" : body.id;
    const link = { ...record(), ...savedLinks.get(id), ...body, id, status: body.action === "revoke" ? "revoked" : "active" };
    savedLinks.set(id, link);
    return new Response(JSON.stringify({ link, ...(init.method === "POST" ? { accessUrl: "https://planner.example/projects/sample-house/overview?accessLink=private-read-token" } : {}) }), { status: init.method === "POST" ? 201 : 200 });
  }));
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  await act(async () => { root!.render(createElement(ReadAccessLinks, { projectId: "sample-house", language: options.language || "es", sections: [{ id: "overview", label: "Resumen" }, { id: "budget", label: "Presupuesto" }, { id: "distribution", label: "Distribución 3D" }], renderFolderPicker: () => null, onAccessChanged: options.onAccessChanged })); });
  return actions;
}
function button(text: string) { const result = [...container.querySelectorAll("button")].find(item => item.textContent === text); expect(result).toBeDefined(); return result!; }
async function click(text: string) { await act(async () => { button(text).click(); }); }
function getField(label: string) {
  return [...container.querySelectorAll("label")].find(item => item.querySelector("span")?.textContent === label)!.querySelector("input,select") as HTMLInputElement | HTMLSelectElement;
}
async function field(label: string, value: string) {
  const element = getField(label);
  await act(async () => { Object.getOwnPropertyDescriptor(element.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype, "value")!.set!.call(element, value); element.dispatchEvent(new Event(element.tagName === "SELECT" ? "change" : "input", { bubbles: true })); });
}

describe("administrator read links", () => {
  it("creates an exact category URL that retains the access capability", async () => {
    const actions = await mount();
    await click("Nuevo enlace de lectura");
    await field("Vista inicial", "budget");
    await field("Agrupación de la categoría", "subcategory");
    await field("Categoría del presupuesto (opcional)", "Baño / ducha & más");
    await click("Crear enlace de lectura");
    const url = new URL((container.querySelector('input[aria-label="Enlace de acceso de lectura"]') as HTMLInputElement).value);
    expect(url.pathname).toBe("/projects/sample-house/budget/subcategory/Ba%C3%B1o%20%2F%20ducha%20%26%20m%C3%A1s");
    expect(url.searchParams.get("accessLink")).toBe("private-read-token");
    expect(url.searchParams.get("lang")).toBe("es");
    expect(actions).toHaveLength(1);
    expect(actions[0].permissions).toEqual(DEFAULT_MEMBER_PERMISSIONS);
    expect(actions[0]).toMatchObject({ authentication: "public", defaultLanguage: "es" });
    expect(actions[0]).not.toHaveProperty("email");
    expect(actions[0]).not.toHaveProperty("role");
  });

  it("starts public links in the current interface language", async () => {
    const actions = await mount(false, "", { language: "en" });
    await click("New read link");
    expect(getField("Who can access").value).toBe("public");
    expect(getField("Default language").value).toBe("en");
    await click("Create read link");
    expect(actions[0]).toMatchObject({ authentication: "public", defaultLanguage: "en" });
    const url = new URL((container.querySelector('input[aria-label="Read access link"]') as HTMLInputElement).value);
    expect(url.searchParams.get("lang")).toBe("en");
  });

  it("lets the administrator choose an account link and English default", async () => {
    const actions = await mount();
    await click("Nuevo enlace de lectura");
    await field("Quién puede acceder", "account");
    await field("Idioma predeterminado", "en");
    await click("Crear enlace de lectura");
    expect(actions[0]).toMatchObject({ authentication: "account", defaultLanguage: "en" });
    const link = container.querySelector(".read-link-record")!;
    expect(link.textContent).toContain("Usuarios con cuenta");
    expect(link.textContent).toContain("Idioma predeterminado: English");
    expect(link.textContent).toContain("2 cuentas incorporadas");
  });

  it("displays public access without account redemption counts", async () => {
    await mount(true, "", { link: { authentication: "public", defaultLanguage: "en" } });
    const link = container.querySelector(".read-link-record")!;
    expect(link.textContent).toContain("Cualquiera con el enlace");
    expect(link.textContent).toContain("Idioma predeterminado: English");
    expect(link.textContent).not.toContain("cuentas incorporadas");
    expect(container.querySelector(".invite-help")?.textContent).toContain("se abren sin iniciar sesión");
  });

  it("preserves account access for legacy links while allowing language updates", async () => {
    const actions = await mount(true);
    const link = container.querySelector(".read-link-record")!;
    expect(link.textContent).toContain("Usuarios con cuenta");
    expect(link.textContent).toContain("Idioma predeterminado: Español");
    await click("Editar permisos");
    expect(getField("Quién puede acceder").value).toBe("account");
    expect(getField("Quién puede acceder").disabled).toBe(true);
    await field("Idioma predeterminado", "en");
    await click("Guardar permisos del enlace");
    expect(actions[0]).toMatchObject({ method: "PATCH", id: "hashed-link-id", action: "update", defaultLanguage: "en" });
    expect(actions[0]).not.toHaveProperty("authentication");
    expect(container.querySelector(".read-link-record")?.textContent).toContain("Idioma predeterminado: English");
    await click("Nuevo enlace de lectura");
    expect(getField("Quién puede acceder").value).toBe("public");
    expect(getField("Idioma predeterminado").value).toBe("es");
  });

  it("updates the language of a retained link without losing its destination or capability", async () => {
    await mount();
    await click("Nuevo enlace de lectura");
    await field("Vista inicial", "budget");
    await field("Agrupación de la categoría", "chapter");
    await field("Categoría del presupuesto (opcional)", "Pisos");
    await click("Crear enlace de lectura");
    await click("Editar permisos");
    await field("Idioma predeterminado", "en");
    await click("Guardar permisos del enlace");
    const url = new URL((container.querySelector('input[aria-label="Enlace de acceso de lectura"]') as HTMLInputElement).value);
    expect(url.pathname).toBe("/projects/sample-house/budget/chapter/Pisos");
    expect(url.searchParams.get("accessLink")).toBe("private-read-token");
    expect(url.searchParams.get("lang")).toBe("en");
  });

  it("copies the full read link with feedback and a manual fallback", async () => {
    await mount();
    await click("Nuevo enlace de lectura");
    const writeText = vi.fn<(url: string) => Promise<void>>(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    await click("Crear enlace de lectura");
    await click("Copiar enlace");
    expect(writeText.mock.calls[0][0]).toContain("?accessLink=private-read-token");
    expect(button("Enlace copiado")).toBeDefined();
    writeText.mockRejectedValueOnce(new Error("Clipboard denied"));
    await click("Enlace copiado");
    expect((container.querySelector('input[aria-label="Dirección para compartir"]') as HTMLInputElement).value).toContain("?accessLink=private-read-token");
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it("updates section permissions without minting another link", async () => {
    const actions = await mount(true);
    await click("Editar permisos");
    const budget = [...container.querySelectorAll("fieldset label")].find(item => item.textContent === "Presupuesto")!.querySelector("input")!;
    await act(async () => { budget.click(); });
    await click("Guardar permisos del enlace");
    expect(actions).toEqual([expect.objectContaining({ method: "PATCH", action: "update", id: "hashed-link-id", permissions: expect.objectContaining({ budget: false, overview: true }) })]);
    expect(container.querySelector('input[aria-label="Enlace de acceso de lectura"]')).toBeNull();
    expect(container.textContent).toContain("Permisos de lectura actualizados.");
  });

  it("revokes the link and removes its active management controls", async () => {
    const actions = await mount(true);
    await click("Revocar enlace");
    expect(actions).toEqual([{ method: "PATCH", id: "hashed-link-id", action: "revoke" }]);
    expect(container.textContent).toContain("Revocado");
    expect([...container.querySelectorAll("button")].some(item => item.textContent === "Revocar enlace")).toBe(false);
  });

  it("shows a failed save without presenting an access URL", async () => {
    await mount(false, "Storage temporarily unavailable");
    await click("Nuevo enlace de lectura");
    await click("Crear enlace de lectura");
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("Storage temporarily unavailable");
    expect(container.querySelector('input[aria-label="Enlace de acceso de lectura"]')).toBeNull();
  });

  it("keeps a newly created link available when revoking an older link", async () => {
    const actions = await mount(true);
    await click("Nuevo enlace de lectura");
    await click("Crear enlace de lectura");
    const older = [...container.querySelectorAll(".read-link-record")].find(item => item.textContent?.includes("Revisión") && item !== container.querySelector(".read-link-record"))!;
    await act(async () => { (older.querySelectorAll("button")[1] as HTMLButtonElement).click(); });
    expect(actions[1]).toEqual({ method: "PATCH", id: "hashed-link-id", action: "revoke" });
    expect((container.querySelector('input[aria-label="Enlace de acceso de lectura"]') as HTMLInputElement).value).toContain("?accessLink=private-read-token");
  });

  it("starts with active links and keeps creation controls behind a separate action", async () => {
    const actions = await mount(true);
    expect(container.querySelector("#read-link-composer")).toBeNull();
    expect(container.querySelector(".read-link-directory")?.textContent).toContain("Revisión");
    expect(container.querySelector("fieldset")).toBeNull();
    await click("Nuevo enlace de lectura");
    expect(container.querySelector("#read-link-composer")).not.toBeNull();
    expect(container.querySelector(".read-link-customize")?.hasAttribute("open")).toBe(false);
    await click("Cancelar");
    expect(container.querySelector("#read-link-composer")).toBeNull();
    expect(actions).toEqual([]);
  });

  it("keeps the URL of a new link while editing another link", async () => {
    await mount(true);
    await click("Nuevo enlace de lectura");
    await click("Crear enlace de lectura");
    const url = (container.querySelector('input[aria-label="Enlace de acceso de lectura"]') as HTMLInputElement).value;
    const older = [...container.querySelectorAll(".read-link-record")].find(item => item.textContent?.includes("Revisión"))!;
    await act(async () => { (older.querySelector("button") as HTMLButtonElement).click(); });
    expect(container.querySelector(".read-link-customize")?.hasAttribute("open")).toBe(true);
    await click("Cancelar");
    expect((container.querySelector('input[aria-label="Enlace de acceso de lectura"]') as HTMLInputElement).value).toBe(url);
  });

  it("refreshes the user directory after link changes without turning a refresh failure into a failed mutation", async () => {
    const refresh = vi.fn(async () => { throw new Error("read unavailable"); });
    await mount(true, "", { onAccessChanged: refresh });
    await click("Revocar enlace");
    expect(refresh).toHaveBeenCalledOnce();
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.querySelector('[role="status"]')?.textContent).toContain("Enlace revocado");
    expect(container.querySelector(".read-link-history")).not.toBeNull();
  });
});
