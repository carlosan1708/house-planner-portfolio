import { beforeEach, describe, expect, it, vi } from "vitest";
import { BUDGET_LINES, CONFIG, DEFAULT_FOLDER_ACCESS, DEFAULT_MEMBER_PERMISSIONS, LEGACY_PROJECT_ID, MEMBERSHIPS, PROJECTS, PURCHASES, WORKBOOK_DRAFTS, membershipId, type MemberRecord } from "@/lib/project";

const mock = vi.hoisted(() => ({
  records: new Map<string, Record<string, unknown>>(), queue: Promise.resolve(), nextId: 0,
  actor: null as MemberRecord | null, beforeTransaction: null as (() => void) | null,
  activity: vi.fn(async () => ({ id: "currency-event" })), usage: vi.fn(),
  prepare: vi.fn(), validate: vi.fn(), write: vi.fn(), cleanup: vi.fn(), afterCommit: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies: async () => ({ set: vi.fn() }) }));
vi.mock("@/lib/auth", () => ({ getSessionMember: async () => mock.actor, requireApproved: async () => mock.actor }));
vi.mock("@/lib/access-links", () => ({ resolveMembershipAccess: async (data: Record<string, unknown>) => ({ ...data, ...(data.removed ? { status: "rejected" } : {}), ...(data.accessLinkId ? { role: "viewer" } : {}) }) }));
vi.mock("@/lib/folders", () => ({ ensureExpenseInvoiceFolder: vi.fn(), ensureExpensePurchaseFolder: vi.fn() }));
vi.mock("@/lib/usage-actions", () => ({ recordActivityUsage: mock.usage }));
vi.mock("@/lib/project-currency-correction", () => ({ prepareProjectCurrencyCorrection: mock.prepare }));
vi.mock("@/lib/activity", () => ({ appendActivity: mock.activity, commitActivity: async (_actor: unknown, _input: unknown, mutate: (transaction: unknown) => void) => {
  const { firestore } = await import("@/lib/firebase-admin");
  return firestore.runTransaction(async (transaction) => mutate(transaction));
} }));
vi.mock("@/lib/firebase-admin", () => {
  const snapshot = (path: string) => ({ exists: mock.records.has(path), id: path.split("/").at(-1), data: () => mock.records.get(path) });
  const query = (collection: string, field?: string, value?: unknown, limit = Infinity) => ({
    read: () => {
      const docs = [...mock.records].filter(([path, data]) => path.startsWith(`${collection}/`) && (!field || data[field] === value)).slice(0, limit).map(([path]) => snapshot(path));
      return { docs, empty: docs.length === 0 };
    },
    get: async () => query(collection, field, value, limit).read(),
    limit: (count: number) => query(collection, field, value, count),
  });
  const firestore = {
    batch: () => {
      const writes = new Map<string, Record<string, unknown>>();
      return { set: (ref: { path: string }, data: Record<string, unknown>, options?: { merge?: boolean }) => writes.set(ref.path, { ...(options?.merge ? mock.records.get(ref.path) : {}), ...data }), commit: async () => { writes.forEach((data, path) => mock.records.set(path, data)); } };
    },
    collection: (collection: string) => ({
      doc: (id = `generated-${++mock.nextId}`) => ({ path: `${collection}/${id}`, id, get: async () => snapshot(`${collection}/${id}`) }),
      where: (field: string, _operator: string, value: unknown) => query(collection, field, value),
    }),
    runTransaction: (callback: (transaction: unknown) => Promise<unknown>) => {
      const operation = mock.queue.then(async () => {
        mock.beforeTransaction?.(); mock.beforeTransaction = null;
        const writes = new Map<string, Record<string, unknown>>();
        const transaction = {
          get: async (ref: { path?: string; read?: () => unknown }) => ref.path ? snapshot(ref.path) : ref.read!(),
          getAll: async (...refs: Array<{ path: string }>) => refs.map((ref) => snapshot(ref.path)),
          set: (ref: { path: string }, data: Record<string, unknown>, options?: { merge?: boolean }) => writes.set(ref.path, { ...(options?.merge ? mock.records.get(ref.path) : {}), ...data }),
        };
        const result = await callback(transaction);
        writes.forEach((data, path) => mock.records.set(path, data));
        return result;
      });
      mock.queue = operation.then(() => undefined, () => undefined);
      return operation;
    },
  };
  return { firestore, projectBucket: null };
});

import { GET, PATCH, POST } from "@/app/api/projects/route";
import { lockProjectCurrency, projectCurrencyLocked, readProjectCurrency, validateProjectCurrency } from "@/lib/project-currency";
import { firestore } from "@/lib/firebase-admin";

const request = (body: unknown) => new Request("https://planner.test/api/projects", { method: "PATCH", body: JSON.stringify(body) });
const edit = (currency = "USD", expectedCurrencyRevision = 0, confirmDenominationCorrection = false) => PATCH(request({ action: "currency", projectId: "shared", currency, expectedCurrencyRevision, confirmDenominationCorrection }));
const projectPath = `${PROJECTS}/shared`, memberPath = `${MEMBERSHIPS}/${membershipId("shared", "owner")}`;

beforeEach(() => {
  vi.clearAllMocks(); mock.records.clear(); mock.queue = Promise.resolve(); mock.nextId = 0; mock.beforeTransaction = null;
  mock.validate.mockReset().mockResolvedValue(undefined); mock.write.mockReset(); mock.cleanup.mockReset().mockResolvedValue(undefined); mock.afterCommit.mockReset().mockResolvedValue({ googleSynced: true });
  mock.prepare.mockReset().mockResolvedValue({ validate: mock.validate, write: mock.write, cleanup: mock.cleanup, afterCommit: mock.afterCommit, planVersion: 2, actualsRevision: 1, paymentCount: 0, objectKey: "prepared-version.xlsx" });
  mock.actor = { uid: "owner", name: "Owner", email: "owner@example.test", projectId: "personal-owner", projectName: "My space", isPersonal: true, role: "admin", status: "approved", permissions: DEFAULT_MEMBER_PERMISSIONS, folderAccess: DEFAULT_FOLDER_ACCESS };
  mock.records.set(projectPath, { name: "Shared house", kind: "shared" });
  mock.records.set(memberPath, { projectId: "shared", uid: "owner", role: "admin", status: "approved" });
});

describe("canonical project currency", () => {
  it("reads legacy projects as CRC without backfilling or changing their names", async () => {
    expect(await readProjectCurrency("shared")).toBe("CRC");
    expect(mock.records.get(projectPath)).toEqual({ name: "Shared house", kind: "shared" });
  });

  it("locks and returns the canonical currency without changing values or revisions", async () => {
    mock.records.set(projectPath, { currency: "USD", currencyRevision: 3, name: "Shared house" });
    expect(await lockProjectCurrency("shared")).toBe("USD");
    expect(await lockProjectCurrency("shared")).toBe("USD");
    expect(mock.records.get(projectPath)).toMatchObject({ currency: "USD", currencyRevision: 3, currencyLocked: true, name: "Shared house" });
    await expect(lockProjectCurrency("missing")).rejects.toThrow("project_not_found");
  });

  it("rejects a changed denomination or revision before a prepared financial write", async () => {
    await expect(firestore.runTransaction(transaction => validateProjectCurrency(transaction, "shared", "CRC", 0))).resolves.toBe("CRC");
    mock.records.set(projectPath, { currency: "USD", currencyRevision: 1 });
    await expect(firestore.runTransaction(transaction => validateProjectCurrency(transaction, "shared", "CRC"))).rejects.toMatchObject({ code: "project_currency_changed", status: 409 });
    await expect(firestore.runTransaction(transaction => validateProjectCurrency(transaction, "shared", "USD", 0))).rejects.toMatchObject({ code: "project_currency_changed", status: 409 });
  });

  it.each([CONFIG, PURCHASES, WORKBOOK_DRAFTS, "housePlannerGoogleBudgets"])("detects legacy financial setup in %s", async (collection) => {
    mock.records.set(`${collection}/shared`, { projectId: "shared", ...(collection === "housePlannerGoogleBudgets" ? { fileId: "sheet" } : {}) });
    expect(await projectCurrencyLocked("shared", {})).toBe(true);
    expect((await edit()).status).toBe(409);
    expect(mock.records.get(projectPath)?.currency).toBeUndefined();
  });

  it("treats the legacy default workbook as initialized before CONFIG or cached lines exist", async () => {
    expect(await projectCurrencyLocked(LEGACY_PROJECT_ID, {})).toBe(true);
    expect(await firestore.runTransaction(transaction => projectCurrencyLocked(LEGACY_PROJECT_ID, {}, transaction))).toBe(true);
  });

  it("keeps an explicit untouched starter editable after its zero-value budget projection is read", async () => {
    mock.records.set(`${CONFIG}/shared`, { projectId: "shared", currencyEditable: true, workbookObjectKey: "house-planner/projects/shared/workbooks/starter.xlsx" });
    mock.records.set(`${BUDGET_LINES}/blank`, { projectId: "shared", objective: 0, quote: 0, paid: 0, excess: 0 });
    expect(await projectCurrencyLocked("shared", {})).toBe(false);
    expect((await edit()).status).toBe(200);
    expect(await lockProjectCurrency("shared")).toBe("USD");
    expect((await edit("CRC", 1)).status).toBe(409);
  });

  it("does not treat populated projected lines or existing drafts as an untouched starter", async () => {
    mock.records.set(`${CONFIG}/shared`, { projectId: "shared", currencyEditable: true, workbookObjectKey: "house-planner/projects/shared/workbooks/starter.xlsx" });
    mock.records.set(`${BUDGET_LINES}/first`, { projectId: "shared", objective: 0, quote: 0, paid: 0 });
    mock.records.set(`${BUDGET_LINES}/second`, { projectId: "shared", objective: 100, quote: 0, paid: 0 });
    expect((await edit()).status).toBe(409);
    mock.records.delete(`${BUDGET_LINES}/second`);
    mock.records.set(`${WORKBOOK_DRAFTS}/draft`, { projectId: "shared" });
    expect((await edit()).status).toBe(409);
  });

  it("does not trust an editable flag retained on a replaced official workbook", async () => {
    mock.records.set(`${CONFIG}/shared`, { projectId: "shared", currencyEditable: true, workbookObjectKey: "house-planner/projects/shared/workbooks/uploaded.xlsx" });
    expect((await edit()).status).toBe(409);
  });
});

describe("project currency API", () => {
  it("lists canonical currency settings and the legacy CRC default", async () => {
    mock.records.set(`${PROJECTS}/personal-owner`, { name: "My space", kind: "personal" });
    mock.records.set(`${MEMBERSHIPS}/${membershipId("personal-owner", "owner")}`, { uid: "owner", projectId: "personal-owner", role: "admin", status: "approved" });
    mock.records.set(projectPath, { name: "Shared house", kind: "shared", currency: "USD", currencyRevision: 5 });
    const response = await GET();
    expect(response.status).toBe(200);
    expect((await response.json()).projects).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "shared", currency: "USD", currencyRevision: 5, currencyLocked: false }),
      expect.objectContaining({ id: "personal-owner", currency: "CRC", currencyRevision: 0, currencyLocked: false }),
    ]));
  });

  it.each([undefined, "CRC", "USD"])("creates a project with the validated denomination %s", async (currency) => {
    const response = await POST(request({ name: "New house", ...(currency ? { currency } : {}) }));
    expect(response.status).toBe(201);
    const { project } = await response.json();
    expect(project).toMatchObject({ currency: currency || "CRC", currencyRevision: 0, currencyLocked: false });
    expect(mock.records.get(`${PROJECTS}/${project.id}`)).toMatchObject({ name: "New house", currency: currency || "CRC", currencyRevision: 0, currencyLocked: false });
  });

  it.each(["EUR", "usd", null, 42])("rejects unsupported creation currency %j before writes", async (currency) => {
    expect((await POST(request({ name: "New house", currency }))).status).toBe(400);
    expect(mock.records.size).toBe(2);
  });

  it("updates an empty project's currency with a revision and audit record", async () => {
    const response = await edit();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ project: { currency: "USD", currencyRevision: 1, currencyLocked: false } });
    expect(mock.records.get(projectPath)).toMatchObject({ currency: "USD", currencyRevision: 1 });
    expect(mock.activity).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ projectId: "shared", role: "admin" }), expect.objectContaining({ action: "project.currency_updated", changes: [{ field: "currency", before: "CRC", after: "USD", format: "text" }] }));
  });

  it.each(["viewer", "editor", "removed", "pending", "read-link"])("does not inherit personal-space admin rights for a %s target grant", async (grant) => {
    mock.records.set(memberPath, { projectId: "shared", uid: "owner", role: grant === "viewer" || grant === "editor" ? grant : "admin", status: grant === "pending" ? "pending" : "approved", ...(grant === "removed" ? { removed: true } : {}), ...(grant === "read-link" ? { accessLinkId: "link" } : {}) });
    expect((await edit()).status).toBe(403);
    expect(mock.activity).not.toHaveBeenCalled();
  });

  it("rechecks revoked administrator access in the transaction", async () => {
    mock.beforeTransaction = () => mock.records.set(memberPath, { role: "viewer", status: "approved" });
    expect((await edit()).status).toBe(403);
    expect(mock.records.get(projectPath)?.currency).toBeUndefined();
  });

  it("rejects mismatched membership identity even when its role says admin", async () => {
    mock.records.set(memberPath, { projectId: "another-project", uid: "another-owner", role: "admin", status: "approved" });
    expect((await edit()).status).toBe(403);
    expect(mock.activity).not.toHaveBeenCalled();
  });

  it("rejects stale settings and permits a locked same-currency no-op", async () => {
    mock.records.set(projectPath, { currency: "USD", currencyRevision: 2, currencyLocked: true });
    expect((await edit("CRC", 1)).status).toBe(409);
    expect((await edit("USD", 2)).status).toBe(200);
    expect(mock.records.get(projectPath)?.currencyRevision).toBe(2);
    expect(mock.activity).not.toHaveBeenCalled();
    expect(mock.prepare).not.toHaveBeenCalled();
  });

  it("requires explicit denomination-correction confirmation before preparing storage", async () => {
    mock.records.set(projectPath, { currency: "CRC", currencyLocked: true });
    const response = await edit();
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "currency_confirmation_required" });
    expect(mock.prepare).not.toHaveBeenCalled();
    expect(mock.write).not.toHaveBeenCalled();
    expect(mock.activity).not.toHaveBeenCalled();
  });

  it("requires confirmation and prepares the legacy workbook when CONFIG has never been materialized", async () => {
    const legacyProjectPath = `${PROJECTS}/${LEGACY_PROJECT_ID}`;
    mock.records.set(legacyProjectPath, { name: "Legacy house" });
    mock.records.set(`${MEMBERSHIPS}/${membershipId(LEGACY_PROJECT_ID, "owner")}`, { projectId: LEGACY_PROJECT_ID, uid: "owner", role: "admin", status: "approved" });
    const legacyEdit = (confirmDenominationCorrection: boolean) => PATCH(request({ action: "currency", projectId: LEGACY_PROJECT_ID, currency: "USD", expectedCurrencyRevision: 0, confirmDenominationCorrection }));
    const unconfirmed = await legacyEdit(false);
    expect(unconfirmed.status).toBe(409);
    expect(await unconfirmed.json()).toMatchObject({ code: "currency_confirmation_required" });
    expect(mock.prepare).not.toHaveBeenCalled();
    expect(mock.records.get(legacyProjectPath)?.currency).toBeUndefined();
    expect((await legacyEdit(true)).status).toBe(200);
    expect(mock.prepare).toHaveBeenCalledWith(LEGACY_PROJECT_ID, "CRC", "USD");
    expect(mock.write).toHaveBeenCalledOnce();
    expect(mock.records.get(legacyProjectPath)).toMatchObject({ currency: "USD", currencyRevision: 1 });
  });

  it("does not prepare confirmed corrections for an unauthorized or stale request", async () => {
    mock.records.set(projectPath, { currency: "CRC", currencyRevision: 1, currencyLocked: true });
    expect((await edit("USD", 0, true)).status).toBe(409);
    mock.records.set(memberPath, { projectId: "shared", uid: "owner", role: "editor", status: "approved" });
    expect((await edit("USD", 1, true)).status).toBe(403);
    expect(mock.prepare).not.toHaveBeenCalled();
  });

  it("commits a confirmed correction through the validated workbook plan", async () => {
    mock.records.set(projectPath, { name: "Shared house", currency: "CRC", currencyLocked: true });
    const response = await edit("USD", 0, true);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ correction: { sourceCurrency: "CRC", currency: "USD", amountsConverted: false, paymentCount: 0, planVersion: 2, actualsRevision: 1 } });
    expect(mock.prepare).toHaveBeenCalledWith("shared", "CRC", "USD");
    expect(mock.validate).toHaveBeenCalledOnce();
    expect(mock.write).toHaveBeenCalledOnce();
    expect(mock.afterCommit).toHaveBeenCalledOnce();
    expect(mock.cleanup).not.toHaveBeenCalled();
    expect(mock.records.get(projectPath)).toMatchObject({ currency: "USD", currencyRevision: 1, currencyLocked: true });
    expect(mock.activity).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ summaryParams: { denominationCorrection: true, confirmationReceived: true, amountsConverted: false, paymentCount: 0, planVersion: 2, actualsRevision: 1 } }));
  });

  it("cleans up prepared artifacts when administrator access changes before commit", async () => {
    mock.records.set(projectPath, { currency: "CRC", currencyLocked: true });
    mock.beforeTransaction = () => mock.records.set(memberPath, { projectId: "shared", uid: "owner", role: "viewer", status: "approved" });
    expect((await edit("USD", 0, true)).status).toBe(403);
    expect(mock.cleanup).toHaveBeenCalledOnce();
    expect(mock.write).not.toHaveBeenCalled();
    expect(mock.records.get(projectPath)?.currency).toBe("CRC");
  });

  it("rejects stale source currency and prepared workbook revisions without mutations", async () => {
    mock.records.set(projectPath, { currency: "CRC", currencyLocked: true });
    mock.beforeTransaction = () => mock.records.set(projectPath, { currency: "USD", currencyRevision: 1, currencyLocked: true });
    expect((await edit("USD", 0, true)).status).toBe(409);
    expect(mock.cleanup).toHaveBeenCalledOnce();
    expect(mock.write).not.toHaveBeenCalled();
    mock.records.set(projectPath, { currency: "CRC", currencyLocked: true });
    mock.validate.mockRejectedValueOnce(new Error("currency_stale"));
    expect((await edit("USD", 0, true)).status).toBe(409);
    expect(mock.cleanup).toHaveBeenCalledTimes(2);
    expect(mock.activity).not.toHaveBeenCalled();
  });

  it("reports synchronization failure as a warning after the correction committed", async () => {
    mock.records.set(projectPath, { currency: "CRC", currencyLocked: true });
    mock.afterCommit.mockRejectedValueOnce(new Error("private upstream details"));
    const response = await edit("USD", 0, true);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ project: { currency: "USD" }, synchronization: { googleSynced: false } });
    expect(mock.records.get(projectPath)?.currency).toBe("USD");
    expect(mock.cleanup).not.toHaveBeenCalled();
  });

  it("allows only one concurrent update from the same settings revision", async () => {
    const responses = await Promise.all([edit(), edit()]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(mock.records.get(projectPath)).toMatchObject({ currency: "USD", currencyRevision: 1 });
    expect(mock.activity).toHaveBeenCalledTimes(1);
  });

  it("serializes financial preparation before a competing denomination change", async () => {
    const [currency, response] = await Promise.all([lockProjectCurrency("shared"), edit()]);
    expect(currency).toBe("CRC");
    expect(response.status).toBe(409);
    expect(mock.records.get(projectPath)).toMatchObject({ currencyLocked: true });
    expect(await readProjectCurrency("shared")).toBe("CRC");
  });

  it.each([{ currency: "EUR", expectedCurrencyRevision: 0 }, { currency: "USD", expectedCurrencyRevision: -1 }, { currency: "USD", expectedCurrencyRevision: "0" }])("validates currency edits before writes: %j", async (body) => {
    expect((await PATCH(request({ action: "currency", projectId: "shared", ...body }))).status).toBe(400);
    expect(mock.activity).not.toHaveBeenCalled();
  });

  it("exposes the granted denomination to anonymous users without project enumeration", async () => {
    mock.actor = { ...mock.actor!, anonymousLink: true, projectId: "shared", projectName: "Shared house", projectCurrency: "USD", role: "viewer", isPersonal: false };
    const response = await GET();
    expect(await response.json()).toMatchObject({ projects: [{ id: "shared", currency: "USD", currencyLocked: true }] });
    expect((await edit()).status).toBe(403);
  });
});
