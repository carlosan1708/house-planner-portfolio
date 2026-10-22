// @vitest-environment jsdom

import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UsageContext } from "@/lib/usage-client";

let client: typeof import("@/lib/usage-client");
let root: Root;
let host: HTMLDivElement;
let calls: Array<{ expectedEmail: string | null; events: Array<{ id: string; kind: string; section: string; action?: string; activeMs?: number }> }>;

function Tracker({ context }: { context: UsageContext | null }) { client.useUsageTracking(context); return null; }
const context: UsageContext = { context: "project", section: "budget", projectId: "p1", expectedEmail: "ana@example.test" };

beforeEach(async () => {
  vi.resetModules(); vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-06T18:00:00Z"));
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init?: RequestInit) => {
    calls.push(JSON.parse(String(init?.body)));
    return new Response("{}", { status: 200 });
  }));
  client = await import("@/lib/usage-client");
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); host.remove();
});

async function render(value: UsageContext | null, strict = false) {
  await act(async () => {
    const element = createElement(Tracker, { context: value });
    root.render(strict ? createElement(StrictMode, null, element) : element);
    await vi.advanceTimersByTimeAsync(5);
  });
  await act(async () => { await vi.advanceTimersByTimeAsync(5); });
}

describe("browser usage tracking", () => {
  it("records one view in Strict Mode, ignores re-render, and measures navigation back", async () => {
    await render(context, true);
    await render({ ...context }, true);
    await render({ ...context, section: "documents" }, true);
    await render(context, true);
    expect(calls.flatMap(call => call.events).filter(event => event.kind === "view").map(event => event.section)).toEqual(["budget", "documents", "budget"]);
  });

  it("does not record mutations from real clients; demo actions are labeled separately", async () => {
    await render(context);
    client.trackUsageInteraction("budget.save");
    client.trackUsageInteraction("workbook.download");
    await client.flushUsage();
    expect(calls.flatMap(call => call.events).filter(event => event.kind === "interaction").map(event => event.action)).toEqual(["workbook.download"]);
    await render({ context: "demo", section: "expenses", expectedEmail: null });
    client.trackDemoAction("expense.save"); await client.flushUsage();
    expect(calls.at(-1)?.expectedEmail).toBeNull();
    expect(calls.at(-1)?.events.at(-1)?.action).toBe("expense.save");
  });

  it("caps time at the idle deadline and excludes hidden or unfocused samples", () => {
    const clock = new client.ActiveUsageClock(0);
    clock.sample(30_000, true, true);
    clock.sample(50_000, false, true);
    clock.sample(60_000, true, false);
    clock.sample(120_000, true, true);
    expect(clock.drain()).toBe(30_000);
    clock.interact(120_000); clock.sample(150_000, true, true);
    expect(clock.drain()).toBe(30_000);
  });

  it("retries the original event ID after a transport failure without throwing", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("offline"));
    await render(context);
    expect(fetch).toHaveBeenCalledTimes(1);
    const first = JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body));
    await expect(client.flushUsage()).resolves.toBeUndefined();
    expect(calls[0].events[0].id).toBe(first.events[0].id);
  });

  it("does not extend activity with heartbeats after becoming idle", async () => {
    await render(context);
    await act(async () => { await vi.advanceTimersByTimeAsync(180_000); });
    const active = calls.flatMap(call => call.events).filter(event => event.kind === "active");
    expect(active.reduce((sum, event) => sum + (event.activeMs || 0), 0)).toBe(60_000);
    expect(active).toHaveLength(1);
  });

  it("flushes the final seconds before changing an authentication cookie", async () => {
    await render(context);
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    await client.flushUsageBeforeTransition();
    const last = calls.at(-1)!;
    expect(last.expectedEmail).toBe("ana@example.test");
    expect(last.events[0].kind).toBe("active");
    expect(last.events[0].activeMs).toBeGreaterThanOrEqual(20_000);
  });

  it("excludes hidden time when browser timers freeze until the tab resumes", async () => {
    await render(context);
    const start = Date.now();
    vi.setSystemTime(start + 10_000);
    vi.mocked(document.hasFocus).mockReturnValue(false);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    window.dispatchEvent(new Event("blur"));
    document.dispatchEvent(new Event("visibilitychange"));
    await client.flushUsage();
    // Jump wall time without running any interval, as a frozen background tab does.
    vi.setSystemTime(start + 50_000);
    vi.mocked(document.hasFocus).mockReturnValue(true);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("focus"));
    await client.flushUsageBeforeTransition();
    const activeMs = calls.flatMap(call => call.events).reduce((sum, event) => sum + (event.activeMs || 0), 0);
    expect(activeMs).toBeGreaterThanOrEqual(10_000);
    expect(activeMs).toBeLessThan(10_020);
  });

  it("bounds waiting for another tab's lock before an authentication transition", async () => {
    vi.spyOn(AbortSignal, "timeout").mockImplementation((milliseconds) => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), milliseconds);
      return controller.signal;
    });
    const request = vi.fn((_name: string, options: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(new DOMException("Lock deadline", "AbortError")));
    }));
    vi.stubGlobal("navigator", { locks: { request } });
    await render(context);
    const transition = client.flushUsageBeforeTransition();
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    await expect(transition).resolves.toBeUndefined();
    expect(request).toHaveBeenCalledWith("house-planner-usage", expect.objectContaining({ signal: expect.any(AbortSignal) }), expect.any(Function));
    expect(fetch).not.toHaveBeenCalled();
  });
});
