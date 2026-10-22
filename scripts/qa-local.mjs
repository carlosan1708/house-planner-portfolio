import { execFileSync, spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync } from "node:fs";
import { createServer, connect } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertIsolatedQaEnvironment, QA_EMULATOR_PROJECT } from "../lib/qa-environment.mjs";
import { QA_IDENTITIES } from "../lib/qa-fixtures.mjs";
import { qaSuitePlan, validateQaEnvironment, validateQaTarget } from "./qa-target-policy.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const suite = process.argv.find((arg) => arg.startsWith("--suite="))?.slice(8) || "permissions";
qaSuitePlan(suite);
const source = {
  commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
  tree: execFileSync("git", ["rev-parse", "HEAD^{tree}"], { cwd: root, encoding: "utf8" }).trim(),
};
const projectId = QA_EMULATOR_PROJECT;
if (projectId !== "demo-house-planner-qa" || !projectId.startsWith("demo-")) throw new Error("Local QA must use the fixed demo emulator project");

// Explicit overrides prevent a developer's active cloud project, credentials or QA secrets
// from entering the local process. These passwords exist only in disposable loopback Auth.
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(?:GOOGLE_|GCLOUD_|GCP_|HOUSE_PLANNER_|QA_|FIREBASE_|NEXT_PUBLIC_(?:FIREBASE_|HOUSE_PLANNER_))/.test(key)));
Object.assign(env, {
  NODE_ENV: "development", HOUSE_PLANNER_ENVIRONMENT: "qa", GOOGLE_CLOUD_PROJECT: projectId,
  GOOGLE_APPLICATION_CREDENTIALS: "", GOOGLE_CLOUD_QUOTA_PROJECT: "", GCLOUD_PROJECT: projectId,
  HOUSE_PLANNER_BUCKET: `${projectId}.appspot.com`, HOUSE_PLANNER_ADMIN_EMAIL: "",
  HOUSE_PLANNER_QA_EMAILS: QA_IDENTITIES.map((identity) => identity.email).join(","),
  HOUSE_PLANNER_QA_PROJECT_IDS: "qa-primary,qa-isolation", HOUSE_PLANNER_PUBLIC_URL: "http://127.0.0.1:3015",
  HOUSE_PLANNER_VAULT_RECOVERY_KEY: randomBytes(32).toString("hex"),
  HOUSE_PLANNER_GOOGLE_SERVICE_ACCOUNT: "", HOUSE_PLANNER_GOOGLE_CLIENT_SECRET: "", HOUSE_PLANNER_GOOGLE_TOKEN_KEY: "", HOUSE_PLANNER_GMAIL_REFRESH_TOKEN: "",
  HOUSE_PLANNER_SOURCE_COMMIT: source.commit, HOUSE_PLANNER_SOURCE_TREE: source.tree,
  FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099", FIRESTORE_EMULATOR_HOST: "127.0.0.1:8088", FIREBASE_STORAGE_EMULATOR_HOST: "127.0.0.1:9199",
  NEXT_PUBLIC_HOUSE_PLANNER_ENVIRONMENT: "qa", NEXT_PUBLIC_FIREBASE_PROJECT_ID: projectId,
  NEXT_PUBLIC_FIREBASE_API_KEY: "local-qa-emulator-key", NEXT_PUBLIC_FIREBASE_APP_ID: "local-qa-emulator-app",
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: `${projectId}.firebaseapp.com`, NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: `${projectId}.appspot.com`,
  NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: "0", NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
  QA_BASE_URL: "http://127.0.0.1:3015", QA_FIREBASE_PROJECT_ID: projectId, QA_PROJECT_ID: "qa-primary", QA_ISOLATION_PROJECT_ID: "qa-isolation",
  QA_AI_MODE: "disabled", QA_AI_ENABLED: "0", QA_CLOUD_PROXY: "0", QA_TARGET_URL: "",
  METADATA_SERVER_DETECTION: "none", FIREBASE_CLI_DISABLE_USAGE_ANALYTICS: "1", NEXT_TELEMETRY_DISABLED: "1", CI: "1",
});
for (const identity of QA_IDENTITIES) {
  env[identity.passwordEnv] = randomBytes(24).toString("base64url");
  env[`QA_${identity.key.toUpperCase()}_EMAIL`] = identity.email;
}
assertIsolatedQaEnvironment(env);
const target = validateQaTarget(env);
if (!target.emulator) throw new Error("Local launcher rejected a cloud target");

const candidates = [
  process.env.QA_FIREBASE_CLI_PATH,
  resolve(root, "node_modules", "firebase-tools", "lib", "bin", "firebase.js"),
  ...(process.env.APPDATA ? [resolve(process.env.APPDATA, "npm", "node_modules", "firebase-tools", "lib", "bin", "firebase.js")] : []),
];
const firebaseCli = candidates.find((candidate) => candidate && existsSync(candidate));
if (!firebaseCli) throw new Error("Install Firebase CLI locally or set QA_FIREBASE_CLI_PATH to its firebase.js entry point");
const logDirectory = resolve(root, ".qa-tools", "logs", `local-${Date.now()}`);
mkdirSync(logDirectory, { recursive: true });
const children = new Set();
const streams = [];
let cleanupPromise;
let stopping = false;

function launch(args, name, inherit = false) {
  const child = spawn(process.execPath, args, { cwd: root, env, stdio: inherit ? "inherit" : ["ignore", "pipe", "pipe"], windowsHide: true, detached: process.platform !== "win32" });
  children.add(child);
  if (!inherit) {
    const log = createWriteStream(resolve(logDirectory, `${name}.log`));
    streams.push(log);
    child.stdout.pipe(log, { end: false });
    child.stderr.pipe(log, { end: false });
  }
  return child;
}

async function cleanup() {
  if (cleanupPromise) return cleanupPromise;
  cleanupPromise = (async () => {
    stopping = true;
    for (const child of [...children].reverse()) {
      if (!child.pid || child.exitCode !== null || child.signalCode !== null) continue;
      if (process.platform === "win32") spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
      else {
        try { process.kill(-child.pid, "SIGTERM"); } catch { /* Already stopped. */ }
      }
    }
    await Promise.all([...children].map((child) => child.exitCode !== null || child.signalCode !== null ? Promise.resolve() : new Promise((done) => {
      const timer = setTimeout(() => { try { process.kill(-child.pid, "SIGKILL"); } catch { /* Already stopped. */ } done(); }, 3000);
      child.once("exit", () => { clearTimeout(timer); done(); });
    })));
    for (const stream of streams) stream.end();
  })();
  return cleanupPromise;
}
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => void cleanup().then(() => process.exit(signal === "SIGINT" ? 130 : 143)));

async function assertPortFree(port) {
  await new Promise((done, reject) => {
    const server = createServer();
    server.once("error", () => reject(new Error(`Local QA port ${port} is in use; stop the conflicting process before retrying`)));
    server.listen(port, "127.0.0.1", () => server.close(done));
  });
}
async function waitForPort(port, child, timeout = 120_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline && !stopping) {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error(`Local QA service exited before port ${port} became available`);
    const ready = await new Promise((done) => {
      const socket = connect(port, "127.0.0.1");
      socket.setTimeout(500);
      const finish = (value) => { socket.destroy(); done(value); };
      socket.once("connect", () => finish(true));
      socket.once("error", () => finish(false));
      socket.once("timeout", () => finish(false));
    });
    if (ready) return;
    await new Promise((done) => setTimeout(done, 500));
  }
  throw new Error(`Local QA startup timed out on port ${port}`);
}
async function waitForNext(child) {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline && !stopping) {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error("Local Next.js server exited during startup");
    try {
      const response = await fetch(`${target.baseUrl}/api/qa/environment`, { signal: AbortSignal.timeout(15_000) });
      if (response.ok) {
        const metadata = validateQaEnvironment(await response.json(), target, source);
        if (metadata.ai?.enabled) throw new Error("Local QA unexpectedly enabled cloud AI");
        return;
      }
    } catch (error) {
      if (error.message?.includes("unexpectedly enabled") || error.message?.startsWith("QA preflight")) throw error;
    }
    await new Promise((done) => setTimeout(done, 1000));
  }
  throw new Error("Local Next.js startup timed out");
}
async function execute(args, name) {
  const child = launch(args, name, true);
  const code = await new Promise((done, reject) => {
    child.once("error", reject);
    child.once("exit", (status) => done(status ?? 1));
  });
  if (code !== 0) throw new Error(`${name} exited with status ${code}`);
}

try {
  if (spawnSync("java", ["-version"], { env, windowsHide: true, stdio: "ignore" }).status !== 0) throw new Error("Firebase emulators need Java; set JAVA_HOME and add its bin directory to PATH");
  for (const port of [3015, 9099, 8088, 9199, 4400, 4500]) await assertPortFree(port);
  process.stdout.write(`Starting isolated local QA (${suite}); logs: ${logDirectory}\n`);
  const emulators = launch([firebaseCli, "emulators:start", "--only", "auth,firestore,storage", "--project", projectId, "--config", resolve(root, "firebase.qa.json"), "--non-interactive"], "emulators");
  await Promise.all([9099, 8088, 9199].map((port) => waitForPort(port, emulators)));
  const next = launch([resolve(root, "node_modules", "next", "dist", "bin", "next"), "dev", "--webpack", "--hostname", "127.0.0.1", "--port", "3015"], "next");
  await waitForNext(next);
  await execute([resolve(root, "scripts", "seed-qa.mjs")], "QA fixture seed");
  await execute([resolve(root, "scripts", "qa-regression.mjs"), `--suite=${suite}`], "QA regression");
  process.stdout.write("Local QA completed; emulators and app are stopping.\n");
} catch (error) {
  process.stderr.write(`${error.message}\nLogs: ${logDirectory}\n`);
  process.exitCode = 1;
} finally {
  await cleanup();
}
