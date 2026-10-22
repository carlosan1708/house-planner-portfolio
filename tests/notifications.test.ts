import { describe, expect, it } from "vitest";
import { buildGmailMessage, countdownJobSpecs, normalizeRecipientUids, reminderCopy } from "@/lib/notifications";

describe("email reminder scheduling", () => {
  it("schedules 24-hour and due jobs for longer countdowns", () => {
    const startedAt = Date.parse("2026-09-01T12:00:00.000Z");
    const dueAt = Date.parse("2026-09-11T12:00:00.000Z");
    expect(countdownJobSpecs("countdown-1", startedAt, dueAt)).toEqual([
      { id: "countdown-1__pre_due", stage: "pre_due", runAtMs: Date.parse("2026-09-10T12:00:00.000Z") },
      { id: "countdown-1__due", stage: "due", runAtMs: dueAt },
    ]);
  });

  it("omits the advance email when no more than 24 hours remain", () => {
    const startedAt = Date.parse("2026-09-10T12:00:00.000Z");
    const dueAt = Date.parse("2026-09-11T12:00:00.000Z");
    expect(countdownJobSpecs("countdown-2", startedAt, dueAt)).toEqual([
      { id: "countdown-2__due", stage: "due", runAtMs: dueAt },
    ]);
  });

  it("deduplicates and limits recipient ids", () => {
    expect(normalizeRecipientUids(["u1", "u1", "", null, "u2"])).toEqual(["u1", "u2"]);
  });
});

describe("bilingual Gmail message", () => {
  it("uses Spanish copy and produces a MIME message without header injection", () => {
    const copy = reminderCopy({ language: "es", projectName: "Proyecto QA", title: "Revisar cocina", dueAt: new Date("2026-09-11T12:00:00.000Z"), stage: "pre_due" });
    expect(copy.heading).toContain("24 horas");
    const raw = buildGmailMessage({
      from: "notifications@example.com",
      to: "qa@example.com\r\nBcc: attacker@example.com",
      projectName: "Proyecto QA",
      title: "Revisar <cocina>",
      dueAt: new Date("2026-09-11T12:00:00.000Z"),
      stage: "due",
      language: "es",
      link: "https://example.com/?section=plan",
      deliveryId: "job__uid",
    });
    const decoded = Buffer.from(raw, "base64url").toString("utf8");
    expect(decoded).toContain("To: qa@example.com Bcc: attacker@example.com");
    expect(decoded).not.toContain("\r\nBcc: attacker@example.com\r\n");
    expect(decoded).toContain("Content-Type: multipart/alternative");
  });

  it("uses English copy for English recipients", () => {
    const copy = reminderCopy({ language: "en", projectName: "QA Project", title: "Review kitchen", dueAt: new Date("2026-09-11T12:00:00.000Z"), stage: "due" });
    expect(copy.heading).toBe("This reminder is due now");
  });
});
