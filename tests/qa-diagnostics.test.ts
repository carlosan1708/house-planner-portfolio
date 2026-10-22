import { describe, expect, it } from "vitest";
import { qaNotificationDiagnostic } from "@/lib/qa-diagnostics";

describe("QA diagnostics redaction", () => {
  it("projects only scheduling state and removes recipient and secret fields", () => {
    const diagnostic = qaNotificationDiagnostic({
      stage: "pre_due",
      status: "pending",
      runAt: { toDate: () => new Date("2026-09-09T12:00:00.000Z") },
      email: "private@example.com",
      recipientUids: ["secret-uid"],
      accessToken: "secret-token",
      documentBody: "private document body",
    });

    expect(diagnostic).toEqual({ stage: "pre_due", status: "pending", runAt: "2026-09-09T12:00:00.000Z" });
    expect(JSON.stringify(diagnostic)).not.toMatch(/private|secret|recipient|token|document/i);
  });
});
