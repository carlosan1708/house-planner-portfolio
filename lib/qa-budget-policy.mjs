export const QA_BILLING_PROJECT = "house-planner-qa-example";
export const QA_BILLING_ACCOUNT = "000000-000000-000000";
export const QA_TOTAL_BUDGET_NAME = "House Planner QA total USD6.00";
export const QA_MONTHLY_TARGET_USD = 6;
export const QA_EARLY_CUTOFF_USD = 5.75;
export const QA_RESERVATION_POLICY = Object.freeze({
  schemaVersion: 1,
  baseAllowanceUsd: 0.5,
  cutoffUsd: QA_EARLY_CUTOFF_USD,
  build: { amountUsd: 0.35, maxCount: 11 },
  regression: { amountUsd: 0.15, maxCount: 10 },
});

export function parseQaBudgetMessage(body, now = new Date()) {
  if (typeof body?.message?.data !== "string" || !body.message.data || body.message.data.length > 16_384) throw new Error("Invalid budget message");
  const data = JSON.parse(Buffer.from(body.message.data, "base64").toString("utf8"));
  // Preserve signed reports from the previous budget during the approved in-place transition.
  const recognizedBudget = (data.budgetDisplayName === QA_TOTAL_BUDGET_NAME && data.budgetAmount === QA_MONTHLY_TARGET_USD)
    || (data.budgetDisplayName === "House Planner QA total USD5.50" && data.budgetAmount === 5.5)
    || (data.budgetDisplayName === "House Planner QA total USD5" && data.budgetAmount === 5);
  if (!recognizedBudget || data.currencyCode !== "USD") throw new Error("Unexpected QA budget");
  if (!Number.isFinite(data.costAmount) || data.costAmount < 0) throw new Error("Invalid QA cost");
  const start = new Date(data.costIntervalStart);
  if (!Number.isFinite(start.getTime()) || start > now) throw new Error("Invalid budget period");
  const period = start.toISOString().slice(0, 7);
  // Delayed events cannot disable a fresh month's QA resources.
  if (period !== now.toISOString().slice(0, 7)) return null;
  return { period, costAmount: data.costAmount, cutoff: data.costAmount >= QA_EARLY_CUTOFF_USD };
}

export function assertQaBillingTarget(env) {
  if (env.HOUSE_PLANNER_ENVIRONMENT !== "qa" || env.GOOGLE_CLOUD_PROJECT !== QA_BILLING_PROJECT) throw new Error("QA billing target mismatch");
  const email = `qa-budget-push@${QA_BILLING_PROJECT}.iam.gserviceaccount.com`;
  if (env.QA_BUDGET_PUSH_EMAIL !== email || !/^https:\/\/house-planner-qa-[a-z0-9-]+\.us-central1\.run\.app$/.test(env.QA_BUDGET_PUSH_AUDIENCE || "")) throw new Error("QA budget push configuration mismatch");
  return { email, audience: env.QA_BUDGET_PUSH_AUDIENCE, projectId: QA_BILLING_PROJECT };
}

const isObject = (value) => value && typeof value === "object" && !Array.isArray(value) && [null, Object.prototype].includes(Object.getPrototypeOf(value));
const validId = (value) => typeof value === "string" && /^[a-zA-Z0-9_.-]{1,120}$/.test(value);
const kindPolicy = (kind) => ["build", "regression"].includes(kind) ? QA_RESERVATION_POLICY[kind] : null;
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const sumCents = (state) => Math.round(state.baseAllowanceUsd * 100) + Object.values(state.reservations).reduce((sum, entry) => sum + Math.round(entry.amountUsd * 100), 0);

/** Validate stored state before either reusing a month or rolling its allowance forward. */
export function prepareQaBudgetLedger(existing, now = new Date()) {
  if (!Number.isFinite(now.getTime())) throw new Error("Invalid QA budget clock");
  const period = now.toISOString().slice(0, 7);
  const fresh = () => ({ schemaVersion: QA_RESERVATION_POLICY.schemaVersion, period, reservations: {}, baseAllowanceUsd: QA_RESERVATION_POLICY.baseAllowanceUsd });
  if (existing === undefined) return fresh();
  if (!isObject(existing) || Object.keys(existing).some((key) => !["schemaVersion", "period", "reservations", "baseAllowanceUsd"].includes(key)) || (existing.schemaVersion !== undefined && existing.schemaVersion !== QA_RESERVATION_POLICY.schemaVersion)) throw new Error("Invalid QA budget ledger schema");
  if (typeof existing.period !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(existing.period) || existing.period > period) throw new Error("Invalid or future QA budget ledger period");
  if (existing.baseAllowanceUsd !== QA_RESERVATION_POLICY.baseAllowanceUsd || !isObject(existing.reservations)) throw new Error("Invalid QA budget ledger allowance or reservations");
  const reservations = {};
  const counts = { build: 0, regression: 0 };
  for (const [key, entry] of Object.entries(existing.reservations)) {
    if (!isObject(entry) || Object.keys(entry).some((name) => !["kind", "amountUsd", "createdAt"].includes(name))) throw new Error("Invalid QA budget reservation schema");
    const policy = kindPolicy(entry.kind);
    const prefix = `${entry.kind}:`;
    if (!policy || !key.startsWith(prefix) || !validId(key.slice(prefix.length)) || entry.amountUsd !== policy.amountUsd) throw new Error("Invalid QA budget reservation kind, ID or amount");
    const createdAt = Date.parse(entry.createdAt);
    if (typeof entry.createdAt !== "string" || !Number.isFinite(createdAt) || new Date(createdAt).toISOString().slice(0, 7) !== existing.period || createdAt > now.getTime() + 60_000) throw new Error("Invalid QA budget reservation timestamp");
    if (++counts[entry.kind] > policy.maxCount) throw new Error("QA budget ledger exceeds monthly operation limits");
    reservations[key] = { kind: entry.kind, amountUsd: entry.amountUsd, createdAt: entry.createdAt };
  }
  const validated = { schemaVersion: QA_RESERVATION_POLICY.schemaVersion, period: existing.period, reservations, baseAllowanceUsd: existing.baseAllowanceUsd };
  if (sumCents(validated) > Math.round(QA_RESERVATION_POLICY.cutoffUsd * 100)) throw new Error("QA budget ledger exceeds its forecast cutoff");
  // Validate old records first; malformed storage cannot silently become a new allowance.
  return existing.period === period ? validated : fresh();
}

export function qaBudgetStatus(existing, now = new Date()) {
  const state = prepareQaBudgetLedger(existing, now);
  const entries = Object.values(state.reservations);
  return { period: state.period, reservedEstimateUsd: sumCents(state) / 100, builds: entries.filter((entry) => entry.kind === "build").length, regressions: entries.filter((entry) => entry.kind === "regression").length, cutoffUsd: QA_RESERVATION_POLICY.cutoffUsd, monthlyTargetUsd: QA_MONTHLY_TARGET_USD, estimateOnly: true };
}

export function reserveQaBudget(existing, operation, now = new Date()) {
  const state = prepareQaBudgetLedger(existing, now);
  const policy = kindPolicy(operation?.kind);
  if (!policy || !validId(operation?.id)) throw new Error("A valid unique QA build/regression reservation ID is required");
  const key = `${operation.kind}:${operation.id}`;
  if (own(state.reservations, key)) return { state, changed: false, status: qaBudgetStatus(state, now) };
  const count = Object.values(state.reservations).filter((entry) => entry.kind === operation.kind).length;
  if (count >= policy.maxCount || sumCents(state) + Math.round(policy.amountUsd * 100) > Math.round(QA_RESERVATION_POLICY.cutoffUsd * 100)) throw new Error("QA monthly reservation cutoff reached; no more cloud work this month");
  state.reservations[key] = { kind: operation.kind, amountUsd: policy.amountUsd, createdAt: now.toISOString() };
  return { state, changed: true, status: qaBudgetStatus(state, now) };
}
