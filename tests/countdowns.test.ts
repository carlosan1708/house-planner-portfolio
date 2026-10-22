import { describe, expect, it } from "vitest";
import { countdownNeedsAttention, countdownTiming, normalizeCountdownDays } from "@/lib/countdowns";

describe("plan countdowns", () => {
  it("defaults to ten days and constrains custom durations", () => {
    expect(normalizeCountdownDays(undefined)).toBe(10);
    expect(normalizeCountdownDays(0)).toBe(1);
    expect(normalizeCountdownDays(500)).toBe(365);
  });

  it("reports progress and becomes due on the tenth day", () => {
    const startedAt = "2026-08-01T12:00:00.000Z";
    const dueAt = "2026-08-11T12:00:00.000Z";
    expect(countdownTiming({ startedAt, dueAt }, new Date(startedAt).getTime() - 50)).toMatchObject({ due: false, daysRemaining: 10, progress: 0 });
    expect(countdownTiming({ startedAt, dueAt }, new Date("2026-08-06T12:00:00.000Z").getTime())).toMatchObject({ due: false, daysRemaining: 5, progress: 50 });
    expect(countdownTiming({ startedAt, dueAt }, new Date(dueAt).getTime())).toMatchObject({ due: true, daysRemaining: 0, progress: 100 });
  });
});

const dueTask = { id: "task", title: "Inspection", startedAt: "2026-08-01T12:00:00Z", dueAt: "2026-08-02T12:00:00Z", durationDays: 1, acknowledged: false, notifyCurrentUser: true, createdBy: "tester@example.test", recipientUids: ["tester"] };
it("keeps legacy overdue tasks active but suppresses completed and acknowledged alerts", () => {
  const now = Date.parse("2026-08-03T12:00:00Z");
  expect(countdownNeedsAttention(dueTask, now)).toBe(true);
  expect(countdownNeedsAttention({ ...dueTask, completed: true }, now)).toBe(false);
  expect(countdownNeedsAttention({ ...dueTask, acknowledged: true }, now)).toBe(false);
  expect(countdownNeedsAttention({ ...dueTask, notifyCurrentUser: false }, now)).toBe(false);
});
