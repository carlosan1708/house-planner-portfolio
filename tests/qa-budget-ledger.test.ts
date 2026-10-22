import { describe, expect, it, vi } from "vitest";
import { updateQaBudgetLedger } from "../scripts/qa-budget-control.mjs";
import { reserveQaBudget } from "../lib/qa-budget-policy.mjs";

const now = new Date("2026-10-08T12:00:00Z");
const options = () => ({ bucket: "house-planner-qa-example-files", headers: { Authorization: "Bearer test-only" }, action: "reserve", kind: "regression", id: "requested-run", now: () => now });

describe("generation-checked QA budget storage", () => {
  it("creates a first ledger only when the object generation is still zero", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(null, { status: 404 })).mockResolvedValueOnce(new Response(null, { status: 201 }));
    expect(await updateQaBudgetLedger({ ...options(), fetcher })).toMatchObject({ reservedEstimateUsd: 0.65, regressions: 1 });
    const [url, request] = fetcher.mock.calls[1];
    expect(String(url)).toContain("ifGenerationMatch=0");
    expect(JSON.parse(String(request?.body))).toMatchObject({ schemaVersion: 1, period: "2026-10", reservations: { "regression:requested-run": { kind: "regression", amountUsd: 0.15 } } });
  });

  it("recomputes after another writer wins and preserves both reservations", async () => {
    const original = reserveQaBudget(undefined, { kind: "build", id: "initial" }, now).state;
    const concurrent = reserveQaBudget(original, { kind: "regression", id: "another-run" }, now).state;
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ generation: "1" }))
      .mockResolvedValueOnce(Response.json(original))
      .mockResolvedValueOnce(new Response(null, { status: 412 }))
      .mockResolvedValueOnce(Response.json({ generation: "2" }))
      .mockResolvedValueOnce(Response.json(concurrent))
      .mockResolvedValueOnce(new Response(null, { status: 201 }));
    expect(await updateQaBudgetLedger({ ...options(), fetcher })).toMatchObject({ reservedEstimateUsd: 1.15, builds: 1, regressions: 2 });
    expect(String(fetcher.mock.calls[2][0])).toContain("ifGenerationMatch=1");
    expect(String(fetcher.mock.calls[5][0])).toContain("ifGenerationMatch=2");
    const stored = JSON.parse(String(fetcher.mock.calls[5][1]?.body));
    expect(Object.keys(stored.reservations).sort()).toEqual(["build:initial", "regression:another-run", "regression:requested-run"]);
  });

  it("does not charge again when a retry reads its already committed reservation", async () => {
    const committed = reserveQaBudget(undefined, { kind: "regression", id: "requested-run" }, now).state;
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ generation: "9" })).mockResolvedValueOnce(Response.json(committed));
    expect(await updateQaBudgetLedger({ ...options(), fetcher })).toMatchObject({ reservedEstimateUsd: 0.65, regressions: 1 });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("reads the existing ten-build ledger under the approved limits without writing or resetting it", async () => {
    let existing;
    for (let index = 0; index < 10; index++) existing = reserveQaBudget(existing, { kind: "build", id: `b${index}` }, now).state;
    for (let index = 0; index < 8; index++) existing = reserveQaBudget(existing, { kind: "regression", id: `r${index}` }, now).state;
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ generation: "7" })).mockResolvedValueOnce(Response.json(existing));
    expect(await updateQaBudgetLedger({ ...options(), action: "status", fetcher })).toMatchObject({ reservedEstimateUsd: 5.2, builds: 10, regressions: 8, cutoffUsd: 5.75, monthlyTargetUsd: 6 });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls.every(([, request]) => !request?.method || request.method === "GET")).toBe(true);
  });

  it("bounds unresolved generation conflicts rather than overwriting shared state", async () => {
    const fetcher = vi.fn<typeof fetch>();
    for (let index = 0; index < 5; index++) fetcher.mockResolvedValueOnce(new Response(null, { status: 404 })).mockResolvedValueOnce(new Response(null, { status: 412 }));
    await expect(updateQaBudgetLedger({ ...options(), fetcher })).rejects.toThrow("Concurrent QA budget updates");
    expect(fetcher).toHaveBeenCalledTimes(10);
    expect(fetcher.mock.calls.filter(([, request]) => request?.method === "POST").every(([url]) => String(url).includes("ifGenerationMatch=0"))).toBe(true);
  });

  it("refuses production before authentication or storage requests", async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(updateQaBudgetLedger({ ...options(), bucket: "example-house-planner-house-planner-prod", fetcher })).rejects.toThrow("isolated QA bucket");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("does not overwrite malformed metadata or corrupted ledger contents", async () => {
    const badGeneration = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ generation: "../unknown" }));
    await expect(updateQaBudgetLedger({ ...options(), fetcher: badGeneration })).rejects.toThrow("object generation");
    expect(badGeneration).toHaveBeenCalledTimes(1);
    const corrupted = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ generation: "7" })).mockResolvedValueOnce(Response.json({ period: "2026-10", baseAllowanceUsd: 0, reservations: {} }));
    await expect(updateQaBudgetLedger({ ...options(), fetcher: corrupted })).rejects.toThrow("allowance");
    expect(corrupted).toHaveBeenCalledTimes(2);
  });
});
