import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { GoogleAuth } from "google-auth-library";
import { QA_BILLING_PROJECT, qaBudgetStatus, reserveQaBudget } from "../lib/qa-budget-policy.mjs";

/** Re-read and recompute after a generation conflict so concurrent reservations cannot erase each other. */
export async function updateQaBudgetLedger({ bucket, headers, action = "status", kind, id, fetcher = fetch, now = () => new Date() }) {
  if (bucket !== `${QA_BILLING_PROJECT}-files`) throw new Error("Cost control requires the exact isolated QA bucket");
  if (!["status", "reserve"].includes(action)) throw new Error("Unknown QA budget action");
  if (action === "reserve" && (!["build", "regression"].includes(kind) || !/^[a-zA-Z0-9_.-]{1,120}$/.test(id || ""))) throw new Error("A unique build/regression reservation ID is required");
  const object = "qa-controls/monthly-reservations.json";
  const base = `https://storage.googleapis.com/storage/v1/b/${bucket}/o/${encodeURIComponent(object)}`;
  for (let attempt = 0; attempt < 5; attempt++) {
    const meta = await fetcher(base, { headers, signal: AbortSignal.timeout(30_000) });
    if (!meta.ok && meta.status !== 404) throw new Error(`QA ledger read failed (${meta.status})`);
    const generation = meta.ok ? (await meta.json()).generation : "0";
    if (typeof generation !== "string" || !/^[0-9]+$/.test(generation)) throw new Error("QA ledger has invalid object generation");
    let existing;
    if (generation !== "0") {
      const read = await fetcher(`${base}?alt=media&generation=${generation}`, { headers, signal: AbortSignal.timeout(30_000) });
      if ([404, 412].includes(read.status)) continue;
      if (!read.ok) throw new Error(`QA ledger data read failed (${read.status})`);
      existing = await read.json();
    }
    const at = now();
    const reservation = action === "reserve" ? reserveQaBudget(existing, { kind, id }, at) : null;
    if (reservation?.changed) {
      const write = await fetcher(`https://storage.googleapis.com/upload/storage/v1/b/${bucket}/o?uploadType=media&name=${encodeURIComponent(object)}&ifGenerationMatch=${generation}`, { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify(reservation.state), signal: AbortSignal.timeout(30_000) });
      if (write.status === 412) continue;
      if (!write.ok) throw new Error(`QA reservation failed (${write.status})`);
    }
    return reservation?.status || qaBudgetStatus(existing, at);
  }
  throw new Error("Concurrent QA budget updates prevented a reservation; retry later");
}

async function main() {
  const project = process.env.QA_FIREBASE_PROJECT_ID;
  if (project !== QA_BILLING_PROJECT) throw new Error("Cost control requires the exact isolated QA project");
  const option = (name) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
  // Local operators use their current gcloud login; CI uses keyless WIF ADC.
  let headers;
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    headers = Object.fromEntries((await new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] }).getRequestHeaders()).entries());
  } else {
    const result = spawnSync(process.platform === "win32" ? "gcloud.cmd" : "gcloud", ["auth", "print-access-token", `--project=${project}`], { encoding: "utf8", shell: process.platform === "win32", timeout: 30_000 });
    if (result.status !== 0 || !result.stdout.trim()) throw new Error("QA cost control needs authenticated gcloud or WIF credentials");
    headers = { Authorization: `Bearer ${result.stdout.trim()}` };
  }
  headers["x-goog-user-project"] = project;
  const status = await updateQaBudgetLedger({ bucket: `${project}-files`, headers, action: option("action") || "status", kind: option("kind"), id: option("id") });
  process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
