import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_FOLDER_ACCESS, DEFAULT_MEMBER_PERMISSIONS, type MemberRecord } from "@/lib/project";

const fake = vi.hoisted(() => {
  const docs = new Map<string, Record<string, unknown>>();
  function ref(path: string) {
    return {
      id: path.split("/").at(-1)!,
      path,
      get: async () => ({ exists: docs.has(path), data: () => docs.get(path), updateTime: { seconds: Number(docs.get(path)?.mockVersion || 10), nanoseconds: 0 } }),
      set: async (value: Record<string, unknown>, options?: { merge?: boolean }) => {
        docs.set(path, options?.merge ? { ...docs.get(path), ...value } : value);
      },
      create: async (value: Record<string, unknown>) => {
        if (docs.has(path)) throw new Error("duplicate");
        docs.set(path, value);
      },
      collection: (name: string) => ({ doc: (id: string) => ref(`${path}/${name}/${id}`) }),
      update: async (value: Record<string, unknown>) => { docs.set(path, { ...docs.get(path), ...value }); },
      delete: async () => { docs.delete(path); },
    };
  }
  return { docs, ref, createReminder: vi.fn(), purchase: vi.fn(), payment: vi.fn(), attach: vi.fn(), send: vi.fn(), live: vi.fn(),
    render: vi.fn(), selectSheets: vi.fn(), plans: vi.fn(), resolvePlan: vi.fn(), storageSave: vi.fn() };
});

vi.mock("@/lib/firebase-admin", () => ({
  projectBucket: { file: () => ({ save: fake.storageSave }) },
  firestore: {
    collection: (name: string) => ({
      doc: (id: string) => fake.ref(`${name}/${id}`),
      where: (field: string, _operator: string, value: string) => ({ get: async () => ({
        docs: [...fake.docs].filter(([path, data]) => path.startsWith(`${name}/`) && data[field] === value)
          .map(([path, data]) => ({ id: path.split("/").at(-1), data: () => data })),
      }) }),
    }),
    runTransaction: async (callback: (tx: unknown) => Promise<unknown>) => {
      const writes: (() => void)[] = [];
      const result = await callback({
        get: (ref: ReturnType<typeof fake.ref>) => ref.get(),
        set: (ref: ReturnType<typeof fake.ref>, value: Record<string, unknown>, options?: { merge?: boolean }) =>
          writes.push(() => fake.docs.set(ref.path, options?.merge ? { ...fake.docs.get(ref.path), ...value } : value)),
        update: (ref: ReturnType<typeof fake.ref>, value: Record<string, unknown>) =>
          writes.push(() => fake.docs.set(ref.path, { ...fake.docs.get(ref.path), ...value })),
        create: (ref: ReturnType<typeof fake.ref>, value: Record<string, unknown>) => writes.push(() => {
          if (fake.docs.has(ref.path)) throw new Error("duplicate");
          fake.docs.set(ref.path, value);
        }),
      });
      writes.forEach((write) => write());
      return result;
    },
  },
}));
vi.mock("@/lib/auth", () => ({ requireApproved: fake.live }));
vi.mock("@/lib/gmail", () => ({ gmailConfiguration: () => ({ configured: true, sender: "app@example.test" }), sendGmailMessage: fake.send }));
vi.mock("@/lib/expense-reminders-api", () => ({ createExpenseReminder: fake.createReminder }));

vi.mock("@/lib/expense-purchases-api", () => ({ createExpensePurchase: fake.purchase }));
vi.mock("@/lib/expense-payments-api", () => ({ createExpensePayment: fake.payment, updateExpensePayment: fake.attach }));
vi.mock("@/lib/expense-ledger", () => ({ readPaymentLedgerState: async () => ({ paymentsModelVersion: 2 }) }));
vi.mock("@/lib/assistant-image-model", async (importOriginal) => ({
  readPageAnswer: (await importOriginal<typeof import("@/lib/assistant-image-model")>()).readPageAnswer,
  imageFeatureEnabled: () => true,
  withPlanFile: (_source: unknown, inspect: (file: unknown) => Promise<unknown>) => inspect({
    pageCount: 7, select: fake.selectSheets,
  }),
  renderPlanImage: fake.render,
}));
vi.mock("@/lib/assistant-plan-sources", () => ({
  planMember: (actor: MemberRecord) => actor.projectMembershipVerified && !actor.anonymousLink,
  listImagePlans: fake.plans,
  resolveImagePlan: fake.resolvePlan,
}));

import { conversationRef, readRun, startRun } from "@/lib/assistant-run-store";
import { directlyRequestedDate, proposeAgentAction, requestedConfirmation, requestRunInput, respondToRun } from "@/lib/assistant-run";
import { askForPlan, readAssistantImage, respondToImageRun } from "@/lib/assistant-image-run";

const actor: MemberRecord = {
  uid: "member", email: "member@example.test", name: "Member", projectId: "project", projectName: "Test",
  role: "editor", status: "approved", isPersonal: false, projectMembershipVerified: true,
  permissions: { ...DEFAULT_MEMBER_PERMISSIONS, expenses: true }, folderAccess: DEFAULT_FOLDER_ACCESS,
};
const date = "2027-02-05";
const goal = `Create a reminder for ${date} and email me a confirmation`;
const reminder = { description: "Follow up on synthetic quote", dueDate: date, currency: "CRC" };

beforeEach(() => {
  fake.docs.clear();
  vi.clearAllMocks();
  fake.live.mockResolvedValue(actor);
  const ref = conversationRef("thread");
  fake.docs.set(ref.path, { projectId: actor.projectId, createdByUid: actor.uid });
  fake.createReminder.mockImplementation(async (_actor, request: Request, operation) => {
    const fields = await request.json();
    const id = "reminder-1";
    const operationStore = await import("@/lib/firebase-admin");
    await operationStore.firestore.runTransaction(async (tx) => {
      await operation.validate(tx);
      tx.create(operationStore.firestore.collection("housePlannerExpenses").doc(id), { ...fields, kind: "payment_reminder", projectId: actor.projectId });
      operation.record(tx, id);
    });
    return Response.json({ id }, { status: 201 });
  });
  fake.send.mockResolvedValue("sent-1");
});

describe("app agent checkpoints", () => {
  it("waits for the selected plan, rejects a replay, and gates image reads on current source access", async () => {
    const thread = conversationRef("thread");
    const plan = { key: "document:plan", version: "10:0", name: "Fixture.pdf", location: "Documents", objectKey: "fixture", format: "pdf" };
    fake.plans.mockResolvedValue([plan]);
    fake.resolvePlan.mockResolvedValue(plan);
    fake.selectSheets.mockResolvedValue([1, 3, 4, 5, 7].map(page => ({ page, detail: "" })));
    fake.render.mockResolvedValue({ bytes: Buffer.from("fixture"), model: "image-model", references: [1, 3, 4, 5, 7] });
    const viewer = { ...actor, role: "viewer" as const, permissions: { ...actor.permissions, expenses: false } };
    fake.live.mockResolvedValue(viewer);
    const run = await startRun(thread, viewer, "Render a facade", "en", []);
    const pending = (await askForPlan(viewer, thread, run))!;
    expect(pending.pending).toMatchObject({ kind: "input", options: [{ id: plan.key }] });
    expect(fake.render).not.toHaveBeenCalled();
    const choice = { id: run.id, revision: pending.revision, action: "answer" as const, answer: plan.key };
    await respondToImageRun(viewer, thread, choice);
    await expect(respondToImageRun(viewer, thread, choice)).rejects.toThrow("run_changed");
    expect(fake.render).toHaveBeenCalledTimes(1);
    expect(await readAssistantImage(viewer, thread, run.id)).toMatchObject({ pages: [1, 3, 4, 5, 7] });
    const next = await startRun(thread, viewer, "Render a garden", "en", []);
    fake.plans.mockResolvedValue([{ ...plan, key: "document:other", name: "Other.pdf" }, plan]);
    const suggested = await askForPlan(viewer, thread, next);
    expect(suggested?.pending).toMatchObject({ options: [{ id: plan.key, suggested: true }, { id: "document:other" }] });
    fake.plans.mockResolvedValue([{ ...plan, key: "document:other" }]);
    const restricted = await askForPlan(viewer, thread, suggested!);
    expect(restricted?.pending).toMatchObject({ options: [{ id: "document:other" }] });
    expect(await readAssistantImage({ ...viewer, projectId: "other" }, thread, run.id)).toBeNull();
    fake.resolvePlan.mockResolvedValue(null);
    expect(await readAssistantImage(viewer, thread, run.id)).toBeNull();
  });

  it("asks for ambiguous page numbers and retries with the user's confirmed pages", async () => {
    const thread = conversationRef("thread");
    const plan = { key: "document:plan", version: "10:0", name: "Fixture.pdf", location: "Documents", objectKey: "fixture", format: "pdf" };
    fake.plans.mockResolvedValue([plan]);
    fake.resolvePlan.mockResolvedValue(plan);
    fake.selectSheets.mockResolvedValue([]);
    fake.render.mockRejectedValueOnce(new Error("model unavailable"))
      .mockResolvedValueOnce({ bytes: Buffer.from("fixture"), model: "image-model", references: [2, 5] });
    const run = await startRun(thread, actor, "Render a facade", "en", []);
    const pending = (await askForPlan(actor, thread, run))!;
    await respondToImageRun(actor, thread, { id: run.id, revision: pending.revision, action: "answer", answer: plan.key });
    const askPages = (await readRun(thread))!;
    expect(askPages.pending).toMatchObject({ kind: "input", options: [], question: expect.stringContaining("1 to 7") });
    expect(fake.render).not.toHaveBeenCalled();
    await respondToImageRun(actor, thread, { id: run.id, revision: askPages.revision, action: "answer", answer: "2, 5" });
    const retry = (await readRun(thread))!;
    expect(retry.pending).toMatchObject({ kind: "retry" });
    await respondToImageRun(actor, thread, { id: run.id, revision: retry.revision, action: "retry" });
    expect(fake.selectSheets).toHaveBeenCalledTimes(1);
    expect(fake.render.mock.calls.map(([, evidence]) => evidence.map(({ page }: { page: number }) => page))).toEqual([[2, 5], [2, 5]]);
  });

  it("saves a reminder, retries only its rejected confirmation, and persists the result", async () => {
    const thread = conversationRef("thread");
    let run = await startRun(thread, actor, goal, "en", []);
    ({ run } = await proposeAgentAction(actor, thread, run, "createReminder", reminder, []));
    expect(run.completed[0]).toMatchObject({ tool: "createReminder", id: "reminder-1" });
    fake.send.mockRejectedValueOnce({ response: { status: 429 } });
    ({ run } = await proposeAgentAction(actor, thread, run, "sendReminderConfirmation", { reminderId: "reminder-1" }, []));
    expect(run.status).toBe("retry");
    expect(run.pending).toEqual({ kind: "retry", question: "Your reminder was saved. The confirmation email could not be sent. You can retry sending it." });
    const restored = (await readRun(conversationRef("thread")))!;
    const result = await respondToRun(actor, thread, { id: restored.id, revision: restored.revision, action: "retry" });
    expect(result.completed.map(({ tool, id, status }) => ({ tool, id, status }))).toEqual([
      { tool: "createReminder", id: "reminder-1", status: undefined },
      { tool: "sendReminderConfirmation", id: "reminder-1", status: "sent" },
    ]);
    expect(fake.createReminder).toHaveBeenCalledTimes(1);
    expect(fake.send).toHaveBeenCalledTimes(2);
  });

  it("carries reviewed purchase and payment IDs across the receipt tool and prevents a replay", async () => {
    const thread = conversationRef("thread");
    fake.docs.set("housePlannerExpenseDocuments/receipt-1", { projectId: actor.projectId, title: "Transfer receipt" });
    const { firestore } = await import("@/lib/firebase-admin");
    const write = (collection: string, id: string) => async (_actor: MemberRecord, request: Request, operation: import("@/lib/agent-write").AgentWrite) => {
      const fields = await request.json();
      await firestore.runTransaction(async (tx) => {
        await operation.validate(tx);
        tx.set(firestore.collection(collection).doc(id), { ...fields, projectId: actor.projectId }, { merge: true });
        operation.record(tx, id);
      });
      return Response.json({ id }, { status: 201 });
    };
    fake.purchase.mockImplementation(write("housePlannerPurchases", "purchase-1"));
    fake.payment.mockImplementation(write("housePlannerExpensePayments", "payment-1"));
    fake.attach.mockImplementation(write("housePlannerExpensePayments", "payment-1"));
    let run = await startRun(thread, actor, "Record my purchase and deposit, then attach my receipt", "en", []);
    const actions = [
      ["createPurchase", { title: "Panel", currency: "CRC", amount: 250000, purchaseDate: date }],
      ["recordPayment", { purchaseId: "purchase-1", expectedCurrency: "CRC", amount: 100000, paymentDate: date, paymentKind: "partial" }],
      ["attachReceipt", { paymentId: "payment-1", receiptId: "receipt-1" }],
    ] as const;
    for (const [name, args] of actions) {
      ({ run } = await proposeAgentAction(actor, thread, run, name, args, []));
      expect(run.status).toBe("review");
      run = await respondToRun(actor, thread, { id: run.id, revision: run.revision, action: "approve" });
      run = await respondToRun(actor, thread, { id: run.id, revision: run.revision, action: "continue" });
    }
    const replay = await proposeAgentAction(actor, thread, run, "recordPayment", actions[1][1], []);
    expect(replay.outcome?.id).toBe("payment-1");
    expect(fake.purchase).toHaveBeenCalledTimes(1);
    expect(fake.payment).toHaveBeenCalledTimes(1);
    expect(fake.attach).toHaveBeenCalledTimes(1);
    expect(fake.docs.get("housePlannerExpensePayments/payment-1")).toMatchObject({
      purchaseId: "purchase-1", amount: 100000, documentIds: ["receipt-1"],
    });
  });

  it("keeps a pending choice on reopen and rejects stale and cross-project replies", async () => {
    const thread = conversationRef("thread");
    const started = await startRun(thread, actor, "Attach my receipt to last Tuesday's payment", "en", []);
    const pending = await requestRunInput(actor, thread, started, {
      question: "Which payment?", options: [{ id: "p1", label: "First" }, { id: "p2", label: "Second" }],
    }, []);
    const restored = (await readRun(conversationRef("thread")))!;
    expect(restored.pending).toEqual(pending.pending);
    await expect(respondToRun(actor, thread, { ...restored, action: "answer", answer: "p3" })).rejects.toThrow("invalid_answer");
    fake.live.mockResolvedValueOnce({ ...actor, projectId: "other" });
    await expect(respondToRun(actor, thread, { ...restored, action: "answer", answer: "p2" })).rejects.toThrow("project_access_required");
    const answered = await respondToRun(actor, thread, { ...restored, action: "answer", answer: "p2" });
    expect(answered.answer).toBe("Second (selected record ID: p2)");
    await expect(respondToRun(actor, thread, { ...restored, action: "answer", answer: "p1" })).rejects.toThrow("run_changed");
  });

  it("requires review for a derived reminder date and saves edited draft versions", async () => {
    const thread = conversationRef("thread");
    let run = await startRun(thread, actor, "Look up the due date in the quote and create a reminder", "en", []);
    ({ run } = await proposeAgentAction(actor, thread, run, "createReminder", reminder, []));
    expect(run.pending?.kind).toBe("review");
    const edited = await respondToRun(actor, thread, { id: run.id, revision: run.revision, action: "save", fields: { description: "Edited reminder" } });
    expect((await readRun(thread))?.pending).toMatchObject({ kind: "review", action: { fields: { description: "Edited reminder" } } });
    await expect(respondToRun(actor, thread, { id: run.id, revision: run.revision, action: "approve" })).rejects.toThrow("run_changed");
    expect(fake.createReminder).not.toHaveBeenCalled();
    await respondToRun(actor, thread, { id: edited.id, revision: edited.revision, action: "approve" });
    expect(fake.createReminder).toHaveBeenCalledTimes(1);
  });

  it("rejects a changed payment target and prevents work after conversation deletion", async () => {
    const thread = conversationRef("thread");
    const paymentPath = "housePlannerExpensePayments/payment-1";
    fake.docs.set(paymentPath, { projectId: actor.projectId, payee: "Supplier", currency: "CRC", amount: 10000 });
    fake.docs.set("housePlannerExpenseDocuments/receipt-1", { projectId: actor.projectId, title: "Receipt" });
    const { firestore } = await import("@/lib/firebase-admin");
    fake.attach.mockImplementation(async (_actor, _request, operation) => {
      await firestore.runTransaction(async (tx) => {
        await operation.validate(tx);
        operation.record(tx, "payment-1");
      });
      return Response.json({ ok: true });
    });
    let run = await startRun(thread, actor, "Attach a receipt", "en", []);
    ({ run } = await proposeAgentAction(actor, thread, run, "attachReceipt", { paymentId: "payment-1", receiptId: "receipt-1" }, []));
    fake.docs.set(paymentPath, { ...fake.docs.get(paymentPath), amount: 12000, mockVersion: 11 });
    const rejected = await respondToRun(actor, thread, { id: run.id, revision: run.revision, action: "approve" });
    expect(rejected.completed).toEqual([]);
    expect(rejected.status).toBe("ready");
    expect(fake.docs.get(paymentPath)).not.toHaveProperty("documentIds");
    fake.docs.set(thread.path, { ...fake.docs.get(thread.path), deletedAt: true });
    await expect(respondToRun(actor, thread, { id: rejected.id, revision: rejected.revision, action: "continue" })).rejects.toThrow("conversation_not_found");
  });

  it("stops after uncertain provider acceptance and denies a repeated confirmation", async () => {
    const thread = conversationRef("thread");
    let run = await startRun(thread, actor, goal, "en", []);
    ({ run } = await proposeAgentAction(actor, thread, run, "createReminder", reminder, []));
    fake.send.mockRejectedValueOnce(new Error("connection lost"));
    ({ run } = await proposeAgentAction(actor, thread, run, "sendReminderConfirmation", { reminderId: "reminder-1" }, []));
    expect(run.completed.at(-1)?.status).toBe("uncertain");
    const repeated = await proposeAgentAction(actor, thread, run, "sendReminderConfirmation", { reminderId: "reminder-1" }, []);
    expect(repeated.outcome?.status).toBe("uncertain");
    expect(fake.send).toHaveBeenCalledTimes(1);
  });
});

it("only treats unambiguous date-only requests and explicit confirmation as direct actions", () => {
  expect(directlyRequestedDate("Remind me Friday to call the supplier", "2027-02-05", "2027-02-03")).toBe(true);
  expect(directlyRequestedDate("Remind me Friday at 9 am", "2027-02-05", "2027-02-03")).toBe(false);
  expect(directlyRequestedDate("Find the due date and add a reminder", "2027-02-05", "2027-02-03")).toBe(false);
  expect(requestedConfirmation("Create the reminder and email me a confirmation")).toBe(true);
  expect(requestedConfirmation("Create the reminder but don't email me a confirmation")).toBe(false);
});
