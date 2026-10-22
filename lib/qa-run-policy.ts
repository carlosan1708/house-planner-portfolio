export type QaRegressionSuite = "smoke" | "full" | "expenses" | "distribution" | "notes" | "aesthetics" | "documents" | "cleanup";

export function qaShouldResetAfterRun(suite: QaRegressionSuite, completed: boolean) {
  return completed && suite !== "cleanup";
}
