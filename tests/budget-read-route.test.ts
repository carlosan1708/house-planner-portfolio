import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ actor: vi.fn(), payload: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireTabAccess: mocks.actor }));
vi.mock("@/lib/workbook-store", () => ({ budgetPayload: mocks.payload }));
vi.mock("@/lib/google-budget", () => ({ GoogleBudgetSyncError: class GoogleBudgetSyncError extends Error {} }));

import { GET } from "@/app/api/budget/route";
import { GoogleBudgetSyncError } from "@/lib/google-budget";

const saved = { currency: "CRC", objective: 2000, spent: 1600, lines: [{ id: "line-a", paid: 1600 }], editingAllowed: true, planVersion: 3, paymentLedgerRevision: 8 };
const storedRequest = (path = "/api/budget") => new Request(`http://localhost${path}`, { headers: { "x-house-planner-budget-source": "stored" } });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.actor.mockResolvedValue({ uid: "viewer-a", projectId: "authorized-project" });
  mocks.payload.mockResolvedValue(saved);
});

describe("budget reads during Google synchronization failures", () => {
  it("requires budget access before reading any workbook", async () => {
    mocks.actor.mockResolvedValue(null);
    const response = await GET(new Request("http://localhost/api/budget"));
    expect(response.status).toBe(403);
    expect(mocks.actor).toHaveBeenCalledWith("budget");
    expect(mocks.payload).not.toHaveBeenCalled();
  });

  it("returns the normal synchronized budget without a recovery notice", async () => {
    const response = await GET(new Request("http://localhost/api/budget"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(saved);
    expect(mocks.payload).toHaveBeenCalledExactlyOnceWith("authorized-project");
  });

  it("recovers the authorized project's saved budget in read-only mode after a sync failure", async () => {
    const message = "El historial de pagos de Google cambió.";
    mocks.payload.mockRejectedValueOnce(new GoogleBudgetSyncError(message));
    const response = await GET(new Request("http://localhost/api/budget"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ...saved, editingAllowed: false, googleSyncError: message });
    expect(mocks.payload.mock.calls).toEqual([["authorized-project"], ["authorized-project", { skipGoogleSync: true }]]);
  });

  it("returns 503 when the saved budget also cannot be read", async () => {
    mocks.payload.mockRejectedValueOnce(new GoogleBudgetSyncError("Google unavailable"));
    mocks.payload.mockRejectedValueOnce(new Error("Saved workbook unavailable"));
    const response = await GET(new Request("http://localhost/api/budget"));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Saved workbook unavailable" });
    expect(mocks.payload).toHaveBeenCalledTimes(2);
  });

  it("does not mask unrelated budget failures with a fallback", async () => {
    mocks.payload.mockRejectedValueOnce(new Error("Payment ledger unavailable"));
    const response = await GET(new Request("http://localhost/api/budget"));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Payment ledger unavailable" });
    expect(mocks.payload).toHaveBeenCalledExactlyOnceWith("authorized-project");
  });
});

describe("stored budget reads before background synchronization", () => {
  it("returns the authorized snapshot without waiting for Google synchronization", async () => {
    mocks.payload.mockImplementation((_projectId: string, options?: { skipGoogleSync?: boolean }) => options?.skipGoogleSync ? Promise.resolve(saved) : new Promise(() => {}));
    const response = await GET(storedRequest());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ...saved, editingAllowed: false, googleSyncPending: true });
    expect(mocks.actor).toHaveBeenCalledExactlyOnceWith("budget");
    expect(mocks.payload).toHaveBeenCalledExactlyOnceWith("authorized-project", { skipGoogleSync: true });
  });

  it("requires budget access before reading a stored workbook", async () => {
    mocks.actor.mockResolvedValue(null);
    const response = await GET(storedRequest());
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Budget access required" });
    expect(mocks.payload).not.toHaveBeenCalled();
  });

  it("uses the authorized project when a stored request includes a different project query", async () => {
    const response = await GET(storedRequest("/api/budget?projectId=another-project"));
    expect(response.status).toBe(200);
    expect(mocks.payload).toHaveBeenCalledExactlyOnceWith("authorized-project", { skipGoogleSync: true });
  });

  it.each([new Error("Saved workbook unavailable"), new GoogleBudgetSyncError("Stored source unavailable")])("returns 503 without retrying a failed stored read: %s", async (error) => {
    mocks.payload.mockRejectedValueOnce(error);
    const response = await GET(storedRequest());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: error.message });
    expect(mocks.payload).toHaveBeenCalledExactlyOnceWith("authorized-project", { skipGoogleSync: true });
  });

  it("keeps synchronized reads as the default for an unrecognized source header", async () => {
    const response = await GET(new Request("http://localhost/api/budget", { headers: { "x-house-planner-budget-source": "other" } }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(saved);
    expect(mocks.payload).toHaveBeenCalledExactlyOnceWith("authorized-project");
  });
});
