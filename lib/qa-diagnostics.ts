export type QaNotificationDiagnostic = {
  stage: "pre_due" | "due";
  status: string;
  runAt: string | null;
};

function iso(value: unknown) {
  if (!value || typeof value !== "object" || !("toDate" in value)) return null;
  const date = (value as { toDate: () => Date }).toDate();
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function qaNotificationDiagnostic(data: Record<string, unknown>): QaNotificationDiagnostic {
  return {
    stage: data.stage === "pre_due" ? "pre_due" : "due",
    status: typeof data.status === "string" ? data.status.slice(0, 40) : "unknown",
    runAt: iso(data.runAt),
  };
}
