import { randomUUID } from "node:crypto";
import { start } from "node:repl";
import { chromium } from "@playwright/test";
import { QA_IDENTITIES } from "../lib/qa-fixtures.mjs";

export async function openManualQaSession({ target, env }) {
  if (!target.emulator || target.baseUrl !== "http://127.0.0.1:3015") throw new Error("Manual QA requires the isolated loopback target");
  const browser = await chromium.launch();
  let leasePage;
  const runId = `manual-agent-${randomUUID()}`;
  const credentials = (key) => {
    const identity = QA_IDENTITIES.find((item) => item.key === key);
    if (!identity) throw new Error("Unknown QA identity");
    return identity;
  };
  const local = (page) => {
    if (new URL(page.url()).origin !== target.baseUrl) throw new Error("Unexpected QA browser origin");
  };
  const identity = async (page, key) => {
    local(page);
    const expected = credentials(key);
    const response = await page.request.get(`${target.baseUrl}/api/me`);
    const { user } = await response.json();
    if (response.status() !== 200 || user?.email !== expected.email || user?.role !== expected.role ||
        user?.projectId !== expected.projectId || user?.status !== "approved" || user?.isPersonal) throw new Error("QA identity mismatch");
    return { role: user.role, projectId: user.projectId };
  };
  const release = async () => {
    if (!leasePage) return;
    await identity(leasePage, "owner");
    const response = await leasePage.request.delete(`${target.baseUrl}/api/qa/run`, { data: { runId } });
    if (!response.ok() || !(await response.json()).released) throw new Error("QA lease release failed");
    leasePage = undefined;
    return "QA lease released";
  };
  try {
    const shell = start({ prompt: "manual-qa> ", terminal: false, ignoreUndefined: true });
    Object.assign(shell.context, {
      runId, baseUrl: target.baseUrl, identity, release,
      newPage: async (width = 1280, height = 900) => {
        const context = await browser.newContext({ viewport: { width, height } });
        return context.newPage();
      },
      snapshot: async (page) => {
        local(page);
        let result = await page.locator("body").ariaSnapshot();
        for (const item of QA_IDENTITIES) result = result.replaceAll(env[item.passwordEnv], "[redacted]");
        return result;
      },
      fillCredentials: async (page, key) => {
        local(page);
        const item = credentials(key);
        await page.locator("form.auth-form input[name=email]").fill(item.email);
        await page.locator("form.auth-form input[name=password]").fill(env[item.passwordEnv]);
      },
      acquire: async (page) => {
        await identity(page, "owner");
        const response = await page.request.post(`${target.baseUrl}/api/qa/run`, { data: { runId, suite: "smoke", aiMode: "disabled" } });
        if (response.status() !== 201) throw new Error(`QA lease acquisition failed (${response.status()})`);
        leasePage = page;
        return "QA lease acquired";
      },
    });
    process.stdout.write("Manual QA ready. Use newPage(), snapshot(page), fillCredentials(page, key), identity(page, key), acquire(owner), and release(). Exit with .exit.\n");
    await new Promise((resolve) => shell.once("exit", resolve));
    await release();
  } finally {
    await browser.close();
  }
}
