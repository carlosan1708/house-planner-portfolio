import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import { expect, test, type APIResponse, type Page } from "@playwright/test";
import sharp from "sharp";
import type { QaFixture } from "./fixtures";

type Folder = { id: string; name: string; parentId: string | null; encrypted?: boolean; unlocked?: boolean };
type Document = { id: string; name: string; folderId: string; encrypted?: boolean; aiIndexStatus?: string; quoteReferenceEnabled?: boolean };
type Options = {
  owner: Page;
  companion: Page;
  companionEmail: string;
  projectId: string;
  runId: string;
  artifactDirectory: string;
  image: QaFixture;
  guardOwner: () => Promise<unknown>;
  guardCompanion: () => Promise<unknown>;
  waitForProjectReady: (page: Page) => Promise<void>;
};

async function payload<T>(response: APIResponse, status = 200): Promise<T> {
  // Do not include mutation request bodies or response bodies in diagnostics.
  expect(response.status(), `${new URL(response.url()).pathname}: ${response.statusText()}`).toBe(status);
  return response.json() as Promise<T>;
}

const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

export async function verifyEncryptedDocumentFolders(options: Options) {
  const { owner, companion, companionEmail, projectId, runId, artifactDirectory, image, guardOwner, guardCompanion, waitForProjectReady } = options;
  const origin = new URL(process.env.QA_BASE_URL!).origin;
  const headers = { Origin: origin };
  // These disposable passwords belong only to this allowlisted QA workspace.
  // Authentication credentials are provisioned/sign-in outside recorded traces.
  const password = `QA private ${randomUUID()}`;
  const nextPassword = `QA reset ${randomUUID()}`;
  const wrongPassword = `QA wrong ${randomUUID()}`;
  const folderName = `${runId} Privado`;
  const fileName = `${runId}-private.png`;
  const aiRequests: string[] = [];
  const observeAi = (request: { url: () => string }) => {
    const path = new URL(request.url()).pathname;
    if (/^\/api\/(assistant\/(chat|documents)|quotes\/analyze|quote-chat)(\/|$)/.test(path)) aiRequests.push(path);
  };
  owner.on("request", observeAi);
  companion.on("request", observeAi);
  let folderId = "";
  let childId = "";
  let documentId = "";
  let viewerUid = "";
  const files = async (page: Page) => payload<{ documents: Document[] }>(await page.request.get("/api/files"));
  const folders = async (page: Page) => payload<{ folders: Folder[] }>(await page.request.get("/api/folders"));
  const unlock = async (page: Page, value: string, status = 200, targetId = folderId) => {
    await (page === owner ? guardOwner() : guardCompanion());
    return payload<{ unlocked?: boolean }>(await page.request.post("/api/folder-vault", { headers, data: { folderId: targetId, password: value }, failOnStatusCode: false }), status);
  };
  const denyFile = async (page: Page, status: number) => {
    for (const suffix of ["", "&preview=image", "&preview=thumb"]) {
      expect((await page.request.get(`/api/files?id=${encodeURIComponent(documentId)}${suffix}`, { failOnStatusCode: false })).status()).toBe(status);
    }
    expect((await files(page)).documents.some(document => document.id === documentId)).toBe(false);
  };
  const verifyBytes = async (page: Page) => {
    for (const suffix of ["", "&preview=image"]) {
      const response = await page.request.get(`/api/files?id=${encodeURIComponent(documentId)}${suffix}`);
      expect(response.status()).toBe(200);
      expect(response.headers()["cache-control"]).toBe("private, no-store");
      expect(response.headers()["content-type"]).toBe("image/png");
      expect(digest(await response.body())).toBe(digest(image.buffer));
    }
    const thumb = await page.request.get(`/api/files?id=${encodeURIComponent(documentId)}&preview=thumb`);
    expect(thumb.status()).toBe(200);
    expect(thumb.headers()["cache-control"]).toBe("private, no-store");
    expect(thumb.headers()["content-type"]).toBe("image/webp");
    expect((await sharp(await thumb.body()).metadata()).format).toBe("webp");
    const listing = await page.request.get("/api/files");
    expect(listing.headers()["cache-control"]).toBe("private, no-store");
    expect((await payload<{ documents: Document[] }>(listing)).documents.find(document => document.id === documentId))
      .toMatchObject({ name: fileName, folderId: childId, encrypted: true, aiIndexStatus: "encrypted", quoteReferenceEnabled: false });
  };

  try {
    await test.step("owner creates an encrypted root and nested file; locked access hides original, preview and thumbnail", async () => {
      await guardOwner();
      const created = await payload<{ folder: Folder }>(await owner.request.post("/api/folders", { headers, data: { name: folderName, password }, failOnStatusCode: false }), 201);
      folderId = created.folder.id;
      expect(created.folder.encrypted).toBe(true);
      expect((await unlock(owner, password)).unlocked).toBe(true);
      await guardOwner();
      childId = (await payload<{ folder: Folder }>(await owner.request.post("/api/folders", { headers, data: { name: "Contratos privados", parentId: folderId } }), 201)).folder.id;
      await guardOwner();
      const uploaded = await payload<{ id: string; aiIndexStatus: string }>(await owner.request.post("/api/files", {
        headers, multipart: { folderId: childId, file: { name: fileName, mimeType: image.mimeType, buffer: image.buffer } }, failOnStatusCode: false,
      }), 201);
      documentId = uploaded.id;
      expect(uploaded.aiIndexStatus).toBe("encrypted");
      await verifyBytes(owner);
      await guardOwner();
      await payload(await owner.request.delete(`/api/folder-vault?folderId=${encodeURIComponent(folderId)}`, { headers }));
      await denyFile(owner, 423);
      const locked = (await folders(owner)).folders;
      expect(locked.find(folder => folder.id === folderId)).toMatchObject({ encrypted: true, unlocked: false });
      expect(locked.some(folder => folder.id === childId)).toBe(false);
      await unlock(owner, wrongPassword, 403);
      await denyFile(owner, 423);
    });

    await test.step("generic all-folder viewer permission is insufficient; explicit administrator grant and password are both required", async () => {
      await guardCompanion();
      const members = await payload<{ users: Array<{ uid: string; email: string }> }>(await owner.request.get("/api/access"));
      viewerUid = members.users.find(member => member.email.toLowerCase() === companionEmail)?.uid || "";
      expect(viewerUid, "The invited fixed QA viewer must be a project member").toBeTruthy();
      expect((await folders(companion)).folders.some(folder => folder.id === folderId || folder.id === childId)).toBe(false);
      await denyFile(companion, 404);
      await unlock(companion, password, 404);
      expect((await companion.request.get(`/api/folder-vault?folderId=${encodeURIComponent(folderId)}`)).status()).toBe(403);
      await guardCompanion();
      await payload(await companion.request.patch("/api/folder-vault", { headers, data: { folderId, action: "reset-password", newPassword: nextPassword }, failOnStatusCode: false }), 403);
      await guardOwner();
      await payload(await owner.request.patch("/api/folder-vault", { headers, data: { folderId, allowedUids: [viewerUid] } }));
      await unlock(companion, wrongPassword, 403);
      await denyFile(companion, 423);
      expect((await unlock(companion, password, 200, childId)).unlocked).toBe(true);
      expect((await folders(companion)).folders.some(folder => folder.id === childId && folder.parentId === folderId)).toBe(true);
      await verifyBytes(companion);
      await companion.goto(`/projects/${encodeURIComponent(projectId)}/documents/folder/${encodeURIComponent(childId)}`, { waitUntil: "domcontentloaded" });
      await waitForProjectReady(companion);
      await expect(companion.getByText(fileName, { exact: true })).toBeVisible();
      await expect(companion.getByRole("button", { name: /Reset folder password|Restablecer contraseña|Reset password/ })).toHaveCount(0);
      await expect(companion.getByRole("button", { name: /Manage folder access|Administrar acceso a la carpeta/ })).toHaveCount(0);
    });

    await test.step("locked administrator resets without the old password on desktop/mobile and preserves file bytes and member grants", async () => {
      await owner.goto(`/projects/${encodeURIComponent(projectId)}/documents/folder/${encodeURIComponent(folderId)}`, { waitUntil: "domcontentloaded" });
      await waitForProjectReady(owner);
      const vault = owner.locator(".folder-vault");
      await expect(vault).toHaveClass(/locked/);
      await guardOwner();
      await vault.getByRole("button", { name: /Reset folder password|Restablecer contraseña|Reset password/ }).click();
      const reset = vault.locator(".folder-vault-reset");
      await expect(reset).toBeVisible();
      const newInput = reset.getByLabel(/^(New folder password|New password|Nueva contraseña de la carpeta|Nueva contraseña)$/);
      const confirmInput = reset.getByLabel(/^(Confirm new password|Confirm password|Confirmar nueva contraseña|Confirmar contraseña)$/);
      await newInput.fill(nextPassword);
      await confirmInput.fill(wrongPassword);
      const save = reset.getByRole("button", { name: /^(Save new password|Guardar nueva contraseña|Reset password|Restablecer contraseña)$/ });
      await expect(save).toBeDisabled();
      await confirmInput.fill(nextPassword);
      await expect(save).toBeEnabled();
      await owner.setViewportSize({ width: 1280, height: 900 });
      expect(await owner.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await owner.screenshot({ path: join(artifactDirectory, "vault-reset-desktop.png"), fullPage: true });
      await owner.setViewportSize({ width: 390, height: 844 });
      expect(await owner.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await owner.screenshot({ path: join(artifactDirectory, "vault-reset-mobile.png"), fullPage: true });
      await guardOwner();
      const resetResponse = owner.waitForResponse(response => new URL(response.url()).pathname === "/api/folder-vault" && response.request().method() === "PATCH" && response.request().postDataJSON()?.action === "reset-password");
      await save.click();
      const response = await resetResponse;
      expect(response.status()).toBe(200);
      expect(response.request().postDataJSON()).toEqual({ folderId, action: "reset-password", newPassword: nextPassword });
      await expect(vault).toHaveClass(/locked/);
      await denyFile(companion, 423);
      await unlock(owner, password, 403);
      expect((await unlock(owner, nextPassword)).unlocked).toBe(true);
      await verifyBytes(owner);
      const grant = await payload<{ allowedUids: string[] }>(await owner.request.get(`/api/folder-vault?folderId=${encodeURIComponent(folderId)}`));
      await guardCompanion();
      expect(grant.allowedUids).toContain(viewerUid);
      await unlock(companion, password, 403);
      expect((await unlock(companion, nextPassword)).unlocked).toBe(true);
      await verifyBytes(companion);
      await owner.reload();
      await waitForProjectReady(owner);
      await expect(owner.locator(".folder-vault")).toHaveClass(/unlocked/);
      await owner.screenshot({ path: join(artifactDirectory, "vault-unlocked-mobile.png"), fullPage: true });
      await owner.setViewportSize({ width: 1280, height: 900 });
    });

    await test.step("revocation immediately rejects a formerly unlocked viewer and knowing the replacement password grants no access", async () => {
      await guardOwner();
      await payload(await owner.request.patch("/api/folder-vault", { headers, data: { folderId, allowedUids: [] } }));
      await denyFile(companion, 404);
      await unlock(companion, nextPassword, 404);
      expect((await folders(companion)).folders.some(folder => folder.id === folderId || folder.id === childId)).toBe(false);
      await companion.goto(`/projects/${encodeURIComponent(projectId)}/documents`, { waitUntil: "domcontentloaded" });
      await waitForProjectReady(companion);
      await expect(companion.getByText(fileName, { exact: true })).toHaveCount(0);
      await expect(companion.getByRole("button", { name: new RegExp(`^(Open|Abrir) ${folderName}$`) })).toHaveCount(0);
      await companion.screenshot({ path: join(artifactDirectory, "vault-viewer-revoked.png"), fullPage: true });
      expect(aiRequests, "The documents suite must not invoke AI").toEqual([]);
    });
  } finally {
    owner.off("request", observeAi);
    companion.off("request", observeAi);
    // The caller's finally block always runs the guarded permanent QA reset.
  }
}
