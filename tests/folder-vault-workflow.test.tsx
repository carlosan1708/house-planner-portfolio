// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import FolderVault, { FolderEncryptionPending } from "@/app/components/FolderVault";

type ApiFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
let root: Root;
let container: HTMLDivElement;
const onChange = vi.fn<(locked: boolean) => Promise<void>>();

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  onChange.mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

async function settle() {
  await act(async () => { await new Promise((resolve) => window.setTimeout(resolve, 5)); });
}
async function render(props: Partial<Parameters<typeof FolderVault>[0]> = {}) {
  await act(async () => {
    root.render(createElement(FolderVault, { folderId: "vault1", folderName: "Privado", language: "es", unlocked: false, isAdmin: false, onChange, ...props }));
  });
  await settle();
}
function button(name: string) {
  const result = [...container.querySelectorAll("button")].find((item) => item.textContent === name);
  expect(result, `Missing button ${name}`).toBeDefined();
  return result!;
}
async function click(name: string) {
  await act(async () => { button(name).click(); });
  await settle();
}
async function password(value: string, selector = 'input[type="password"]') {
  await act(async () => {
    const input = container.querySelector<HTMLInputElement>(selector)!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await settle();
}
async function unlock() {
  await act(async () => { container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  await settle();
}

describe("protected folder workflow", () => {
  it("explains pending encryption and lets a failed cleanup refresh be retried", async () => {
    let rejectFirst: (reason: Error) => void = () => undefined;
    const onRefresh = vi.fn<() => Promise<void>>()
      .mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { rejectFirst = reject; }))
      .mockResolvedValue(undefined);
    await act(async () => { root.render(createElement(FolderEncryptionPending, { count: 1, language: "es", onRefresh })); });
    expect(container.textContent).toContain("no estarán disponibles hasta que termine la limpieza");
    await click("Actualizar");
    expect(button("Actualizando…").disabled).toBe(true);
    await act(async () => { rejectFirst(new Error("storage")); });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("No se pudo actualizar");
    await click("Actualizar");
    expect(onRefresh).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[role="alert"]')).toBeNull();
    await act(async () => { root.render(createElement(FolderEncryptionPending, { count: 0, language: "es", onRefresh })); });
    expect(container.textContent).toBe("");
  });

  it("requires a password and does not load the admin grant list for a regular member", async () => {
    const api = vi.fn<ApiFetch>(async () => new Response("{}"));
    vi.stubGlobal("fetch", api);
    await render();
    expect(container.textContent).toContain("permiso del administrador y la contraseña");
    expect(button("Desbloquear carpeta").disabled).toBe(true);
    expect(container.querySelector("input")?.type).toBe("password");
    expect(container.querySelector("input")?.getAttribute("autocomplete")).toBe("current-password");
    expect(container.textContent).not.toContain("Administrar acceso");
    await password("short");
    await unlock();
    expect(api).not.toHaveBeenCalled();
    await password("Mi contraseña privada");
    await unlock();
    expect(api).toHaveBeenCalledWith("/api/folder-vault", expect.objectContaining({ method: "POST", body: JSON.stringify({ folderId: "vault1", password: "Mi contraseña privada" }) }));
    expect(onChange).toHaveBeenCalledWith(false);
    expect(container.querySelector<HTMLInputElement>("input")?.value).toBe("");
  });

  it("keeps the folder locked after a rejected password or missing administrator grant", async () => {
    vi.stubGlobal("fetch", vi.fn<ApiFetch>(async () => new Response("{}", { status: 403 })));
    await render();
    await password("Mi contraseña privada");
    await unlock();
    expect(onChange).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("confirma que el administrador te dio acceso");
    expect(container.querySelector<HTMLInputElement>("input")?.value).toBe("");
  });

  it("locks the selected vault and asks the parent to remove decrypted files", async () => {
    const api = vi.fn<ApiFetch>(async () => new Response("{}"));
    vi.stubGlobal("fetch", api);
    await render({ unlocked: true });
    expect(container.querySelector('input[type="password"]')).toBeNull();
    await click("Bloquear carpeta");
    expect(api).toHaveBeenCalledWith("/api/folder-vault?folderId=vault1", { method: "DELETE" });
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("lets the administrator select approved members while the vault is locked", async () => {
    const api = vi.fn<ApiFetch>(async (_input, init) => new Response(JSON.stringify(init?.method === "PATCH" ? {} : {
      allowedUids: ["ana"],
      users: [{ uid: "ana", name: "Ana", email: "ana@example.test" }, { uid: "luis", name: "Luis", email: "luis@example.test" }],
    })));
    vi.stubGlobal("fetch", api);
    await render({ isAdmin: true });
    await click("Administrar acceso a la carpeta");
    expect(api).toHaveBeenCalledWith("/api/folder-vault?folderId=vault1", expect.objectContaining({ cache: "no-store" }));
    expect(container.textContent).toContain("permisos normales de Documentos");
    expect(container.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked).toBe(true);
    await act(async () => { container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[1].click(); });
    await click("Guardar accesos");
    expect(api.mock.calls.at(-1)?.[1]?.body).toBe(JSON.stringify({ folderId: "vault1", allowedUids: ["ana", "luis"] }));
    expect(onChange).toHaveBeenCalledWith(true);
    expect(container.querySelector('[role="status"]')?.textContent).toContain("Accesos guardados. La carpeta se bloqueó");
    expect(container.querySelector<HTMLInputElement>('input[type="password"]')?.value).toBe("");
  });

  it("shows throttling without refreshing or unlocking files", async () => {
    vi.stubGlobal("fetch", vi.fn<ApiFetch>(async () => new Response("{}", { status: 429 })));
    await render();
    await password("Mi contraseña privada");
    await unlock();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Demasiados intentos");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("ignores an old grant response after switching folders", async () => {
    let resolveFirst: (value: Response) => void = () => undefined;
    let requestCount = 0;
    const api = vi.fn<ApiFetch>(async () => ++requestCount === 1
      ? new Promise<Response>((resolve) => { resolveFirst = resolve; })
      : new Response(JSON.stringify({ allowedUids: [], users: [{ uid: "new", email: "new@example.test", name: "Actual" }] })));
    vi.stubGlobal("fetch", api);
    await render({ isAdmin: true });
    await click("Administrar acceso a la carpeta");
    await render({ isAdmin: true, folderId: "vault2", folderName: "Segunda" });
    expect((api.mock.calls[0][1]?.signal as AbortSignal).aborted).toBe(true);
    await click("Administrar acceso a la carpeta");
    await act(async () => { resolveFirst(new Response(JSON.stringify({ allowedUids: ["old"], users: [{ uid: "old", email: "old@example.test", name: "Anterior" }] }))); });
    expect(container.textContent).toContain("Actual");
    expect(container.textContent).not.toContain("Anterior");
  });

  it.each([false, true])("lets the administrator reset the password while unlocked=%s without the old password", async (unlocked) => {
    let resolveReset: (value: Response) => void = () => undefined;
    const api = vi.fn<ApiFetch>(async (_input, init) => init?.method === "PATCH"
      ? new Promise<Response>((resolve) => { resolveReset = resolve; })
      : new Response(JSON.stringify({ allowedUids: [], users: [], passwordResetAvailable: true })));
    vi.stubGlobal("fetch", api);
    await render({ isAdmin: true, unlocked });
    await click("Restablecer contraseña");
    expect(container.textContent).toContain("sin conocer la anterior");
    expect(button("Guardar nueva contraseña").disabled).toBe(true);
    await password("Nueva clave privada", '.folder-vault-reset input[type="password"]');
    await password("Otra clave privada", '.folder-vault-reset label:nth-child(2) input[type="password"]');
    expect(button("Guardar nueva contraseña").disabled).toBe(true);
    await password("Nueva clave privada", '.folder-vault-reset label:nth-child(2) input[type="password"]');
    await click("Guardar nueva contraseña");
    expect(api.mock.calls.at(-1)?.[1]).toEqual(expect.objectContaining({ method: "PATCH", body: JSON.stringify({ folderId: "vault1", action: "reset-password", newPassword: "Nueva clave privada" }) }));
    expect([...container.querySelectorAll<HTMLInputElement>('input[type="password"]')].every(input => input.value === "")).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
    await act(async () => { resolveReset(new Response(JSON.stringify({ ok: true, passwordReset: true }))); });
    expect(onChange).toHaveBeenCalledWith(true);
    expect(container.textContent).toContain("Se conservan los archivos y los accesos autorizados");
    expect(container.textContent).toContain("Se cerraron los desbloqueos anteriores");
    expect(container.querySelector(".folder-vault-reset")).toBeNull();
  });

  it("does not offer reset to members and clears a failed reset before retry", async () => {
    const api = vi.fn<ApiFetch>(async () => new Response("{}", { status: 403 }));
    vi.stubGlobal("fetch", api);
    await render();
    expect(container.textContent).not.toContain("Restablecer contraseña");
    await render({ isAdmin: true });
    await click("Restablecer contraseña");
    await password("Nueva clave privada", '.folder-vault-reset input[type="password"]');
    await password("Nueva clave privada", '.folder-vault-reset label:nth-child(2) input[type="password"]');
    await click("Guardar nueva contraseña");
    expect(onChange).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("No se pudo restablecer");
    expect(button("Guardar nueva contraseña").disabled).toBe(true);
    expect([...container.querySelectorAll<HTMLInputElement>('input[type="password"]')].every(input => input.value === "")).toBe(true);
  });

  it("clears reset credentials when cancelled or navigating to another folder and ignores its old request", async () => {
    let resolveReset: (value: Response) => void = () => undefined;
    const api = vi.fn<ApiFetch>(async (_input, init) => init?.method === "PATCH"
      ? new Promise<Response>((resolve) => { resolveReset = resolve; })
      : new Response(JSON.stringify({ allowedUids: [], users: [], passwordResetAvailable: true })));
    vi.stubGlobal("fetch", api);
    await render({ isAdmin: true });
    await click("Restablecer contraseña");
    await password("Nueva clave privada", '.folder-vault-reset input[type="password"]');
    await click("Cancelar");
    await click("Restablecer contraseña");
    expect(container.querySelector<HTMLInputElement>('.folder-vault-reset input')?.value).toBe("");
    await password("Nueva clave privada", '.folder-vault-reset input[type="password"]');
    await password("Nueva clave privada", '.folder-vault-reset label:nth-child(2) input[type="password"]');
    await click("Guardar nueva contraseña");
    await render({ isAdmin: true, folderId: "vault2" });
    expect((api.mock.calls.find(call => call[1]?.method === "PATCH")?.[1]?.signal as AbortSignal).aborted).toBe(true);
    expect(container.querySelector(".folder-vault-reset")).toBeNull();
    await act(async () => { resolveReset(new Response(JSON.stringify({ ok: true, passwordReset: true }))); });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("disables reset when server recovery is unavailable for the folder", async () => {
    const api = vi.fn<ApiFetch>(async () => new Response(JSON.stringify({ allowedUids: [], users: [], passwordResetAvailable: false })));
    vi.stubGlobal("fetch", api);
    await render({ isAdmin: true });
    await click("Restablecer contraseña");
    await password("Nueva clave privada", '.folder-vault-reset input[type="password"]');
    await password("Nueva clave privada", '.folder-vault-reset label:nth-child(2) input[type="password"]');
    expect(container.textContent).toContain("no está disponible para esta carpeta");
    expect(button("Guardar nueva contraseña").disabled).toBe(true);
    expect(api.mock.calls.every(call => !call[1]?.method)).toBe(true);
  });
});
