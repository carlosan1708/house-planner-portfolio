"use client";

import { useEffect } from "react";

export type UsageContext = {
  context: "access" | "demo" | "project";
  section: string;
  projectId?: string;
  expectedEmail: string | null;
  viewKey?: string;
};
type ClientEvent = {
  id: string;
  kind: "view" | "active" | "interaction";
  context: UsageContext["context"];
  section: string;
  projectId?: string;
  occurredAt: number;
  activeMs?: number;
  action?: string;
};
type QueuedEvent = { event: ClientEvent; expectedEmail: string | null; attempts: number };

/** Integrate only visible, focused time before the idle deadline. */
export class ActiveUsageClock {
  private cursor: number;
  private interaction: number;
  private accumulated = 0;
  constructor(now: number) { this.cursor = now; this.interaction = now; }
  sample(now: number, visible: boolean, focused: boolean) {
    if (visible && focused) this.accumulated += Math.max(0, Math.min(now, this.interaction + 60_000) - this.cursor);
    this.cursor = now;
  }
  interact(now: number) { this.interaction = now; }
  idleFor(now: number) { return Math.max(0, now - this.interaction); }
  drain() { const value = Math.min(60_000, this.accumulated); this.accumulated = 0; return value; }
}

let current: { context: UsageContext; clock: ActiveUsageClock; token: symbol; visible: boolean; focused: boolean } | null = null;
const queue: QueuedEvent[] = [];
let sending = false;
let inFlight: Promise<void> | null = null;
let initialized = false;
let flushTimer: ReturnType<typeof setTimeout> | undefined;
let retryTimer: ReturnType<typeof setTimeout> | undefined;

function sample() {
  if (!current) return;
  // The elapsed interval belongs to the state before this visibility/focus
  // transition. Timers may have been frozen while the tab was hidden.
  current.clock.sample(Date.now(), current.visible, current.focused);
  current.visible = document.visibilityState === "visible";
  current.focused = document.hasFocus();
}

function enqueue(kind: ClientEvent["kind"], extra: Pick<ClientEvent, "activeMs" | "action"> = {}) {
  if (!current) return;
  const context = current.context;
  queue.push({ event: {
    id: crypto.randomUUID(), kind, context: context.context, section: context.section,
    ...(context.projectId ? { projectId: context.projectId } : {}), occurredAt: Date.now(), ...extra,
  }, expectedEmail: context.expectedEmail?.toLowerCase() || null, attempts: 0 });
  // Bound memory during outages. Retried events retain their original IDs.
  if (queue.length > 100) queue.splice(0, queue.length - 100);
  if (!flushTimer) flushTimer = setTimeout(() => { flushTimer = undefined; void flushUsage(); }, 0);
}

function drainTime() {
  sample();
  const activeMs = current?.clock.drain() || 0;
  if (activeMs > 0) enqueue("active", { activeMs });
}

export function flushUsage(): Promise<void> {
  if (!inFlight) inFlight = sendUsage().finally(() => { inFlight = null; });
  return inFlight;
}

async function sendUsage() {
  if (typeof window === "undefined" || sending || !queue.length) return;
  sending = true;
  try {
    while (queue.length) {
      const expectedEmail = queue[0].expectedEmail;
      const first = queue[0].event;
      const count = queue.findIndex((item, index) => index >= 20 || item.expectedEmail !== expectedEmail || item.event.context !== first.context || item.event.projectId !== first.projectId || item.event.section !== first.section);
      const batch = queue.splice(0, count < 0 ? Math.min(queue.length, 20) : count);
      let retry = false;
      try {
        const send = () => fetch("/api/usage/events", {
          method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin",
          keepalive: true, signal: AbortSignal.timeout(2000), body: JSON.stringify({ expectedEmail, events: batch.map(item => item.event) }),
        });
        // Share the initial cookie handshake between tabs of the same browser.
        const response = navigator.locks ? await navigator.locks.request("house-planner-usage", { signal: AbortSignal.timeout(2000) }, send) : await send();
        if (response.ok) initialized = true;
        retry = response.status === 429 || response.status >= 500;
      } catch { retry = true; }
      if (retry) {
        queue.unshift(...batch.filter(item => ++item.attempts < 3));
        if (!retryTimer) retryTimer = setTimeout(() => { retryTimer = undefined; void flushUsage(); }, 60_000);
        break;
      }
    }
  } finally { sending = false; }
}

function flushOnExit() {
  drainTime();
  if (initialized && !sending && queue.length && typeof navigator.sendBeacon === "function") {
    const expectedEmail = queue[0].expectedEmail;
    const first = queue[0].event;
    const count = queue.findIndex((item, index) => index >= 20 || item.expectedEmail !== expectedEmail || item.event.context !== first.context || item.event.projectId !== first.projectId || item.event.section !== first.section);
    const batch = queue.slice(0, count < 0 ? Math.min(queue.length, 20) : count);
    if (navigator.sendBeacon("/api/usage/events", new Blob([JSON.stringify({ expectedEmail, events: batch.map(item => item.event) })], { type: "application/json" }))) queue.splice(0, batch.length);
  }
  void flushUsage();
}

function startTracking(context: UsageContext) {
  const token = Symbol("usage-view");
  current = { context, clock: new ActiveUsageClock(Date.now()), token, visible: document.visibilityState === "visible", focused: document.hasFocus() };
  enqueue("view");
  const interact = () => {
    if (current?.token !== token) return;
    sample();
    const now = Date.now();
    if (current.clock.idleFor(now) >= 30 * 60_000) enqueue("view");
    current.clock.interact(now);
  };
  const suspend = () => { if (current?.token === token) flushOnExit(); };
  const visibility = () => {
    if (document.visibilityState === "hidden") suspend();
    else interact();
  };
  const tick = setInterval(sample, 1000);
  const heartbeat = setInterval(() => { drainTime(); void flushUsage(); }, 60_000);
  for (const name of ["pointerdown", "keydown", "scroll", "touchstart"] as const) window.addEventListener(name, interact, { passive: true });
  window.addEventListener("focus", interact);
  window.addEventListener("blur", suspend);
  window.addEventListener("pagehide", suspend);
  document.addEventListener("visibilitychange", visibility);
  return () => {
    clearInterval(tick); clearInterval(heartbeat);
    for (const name of ["pointerdown", "keydown", "scroll", "touchstart"] as const) window.removeEventListener(name, interact);
    window.removeEventListener("focus", interact);
    window.removeEventListener("blur", suspend);
    window.removeEventListener("pagehide", suspend);
    document.removeEventListener("visibilitychange", visibility);
    if (current?.token === token) { drainTime(); current = null; void flushUsage(); }
  };
}

/** Delay startup one tick so React's Strict Mode probe cannot record a view. */
export function useUsageTracking(context: UsageContext | null) {
  const mode = context?.context;
  const section = context?.section;
  const projectId = context?.projectId;
  const expectedEmail = context?.expectedEmail ?? null;
  const viewKey = context?.viewKey;
  useEffect(() => {
    if (!mode || !section) return;
    let stop: (() => void) | undefined;
    const timer = setTimeout(() => { stop = startTracking({ context: mode, section, projectId, expectedEmail, viewKey }); }, 0);
    return () => { clearTimeout(timer); stop?.(); };
  }, [mode, section, projectId, expectedEmail, viewKey]);
}

export function trackUsageInteraction(action: string) {
  if (!current) return;
  // Mutations in real projects are recorded by the server after success.
  if (current.context.context !== "demo" && !["document.open", "document.download", "workbook.download"].includes(action)) return;
  enqueue("interaction", { action });
}

export function trackDemoAction(action: string) {
  if (current?.context.context === "demo") trackUsageInteraction(action);
}

/** Capture the tail of active time before authentication/project cookies change. */
export async function flushUsageBeforeTransition() {
  drainTime();
  await flushUsage();
}
