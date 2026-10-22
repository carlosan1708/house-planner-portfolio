export const QA_EMULATOR_PROJECT = "demo-house-planner-qa";
export const QA_PRIMARY_PROJECT = "qa-primary";
export const QA_ISOLATION_PROJECT = "qa-isolation";
export const QA_CLOUD_PROJECT_PATTERN = /^house-planner-qa-[a-z0-9-]+$/;

const emulatorKeys = ["FIREBASE_AUTH_EMULATOR_HOST", "FIRESTORE_EMULATOR_HOST", "FIREBASE_STORAGE_EMULATOR_HOST"];
const loopbackHost = /^(?:127\.0\.0\.1|localhost|\[::1\]):[1-9]\d{1,4}$/;
const clean = (value) => typeof value === "string" ? value.trim() : "";

export function resolveFirebaseEnvironment(env = process.env) {
  const declared = clean(env.HOUSE_PLANNER_ENVIRONMENT);
  if (declared && declared !== "qa" && declared !== "production") throw new Error("Unknown House Planner environment");
  const projectId = clean(env.GOOGLE_CLOUD_PROJECT) || "example-house-planner";
  const storageBucket = clean(env.HOUSE_PLANNER_BUCKET);
  const isQaProject = QA_CLOUD_PROJECT_PATTERN.test(projectId) || projectId === QA_EMULATOR_PROJECT;
  const hasEmulator = emulatorKeys.some((key) => clean(env[key]));
  if ((isQaProject || hasEmulator || env.NEXT_PUBLIC_HOUSE_PLANNER_ENVIRONMENT === "qa") && declared !== "qa") {
    throw new Error("QA resources require HOUSE_PLANNER_ENVIRONMENT=qa");
  }
  if (declared !== "qa") return { projectId, storageBucket: storageBucket.split(/\s+/)[0] || undefined, isQa: false, isEmulator: false };
  if (!isQaProject) throw new Error("QA cannot use a production or unknown Firebase project");
  const isEmulator = projectId === QA_EMULATOR_PROJECT;
  if (isEmulator && !emulatorKeys.every((key) => loopbackHost.test(clean(env[key])))) {
    throw new Error("QA emulators require all Auth, Firestore and Storage loopback hosts");
  }
  if (!isEmulator && hasEmulator) throw new Error("Cloud QA cannot mix live resources with emulators");
  if (!storageBucket || !(storageBucket === `${projectId}.firebasestorage.app` || storageBucket === `${projectId}.appspot.com` || storageBucket.startsWith(`${projectId}-`))) {
    throw new Error("QA storage bucket must belong to the isolated QA project");
  }
  for (const key of ["GCLOUD_PROJECT", "GCP_PROJECT", "GOOGLE_CLOUD_QUOTA_PROJECT", "NEXT_PUBLIC_FIREBASE_PROJECT_ID"]) {
    if (clean(env[key]) && clean(env[key]) !== projectId) throw new Error(`QA ${key} project mismatch`);
  }
  if (clean(env.NEXT_PUBLIC_HOUSE_PLANNER_ENVIRONMENT) && env.NEXT_PUBLIC_HOUSE_PLANNER_ENVIRONMENT !== "qa") throw new Error("QA browser environment mismatch");
  if (clean(env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET) && clean(env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET) !== storageBucket) throw new Error("QA browser bucket mismatch");
  if (clean(env.HOUSE_PLANNER_GOOGLE_SERVICE_ACCOUNT) && !clean(env.HOUSE_PLANNER_GOOGLE_SERVICE_ACCOUNT).endsWith(`@${projectId}.iam.gserviceaccount.com`)) throw new Error("QA Google service account project mismatch");
  // Production OAuth tokens must never be reused by QA. Email/Sheets need a separately approved integration setup.
  if (["HOUSE_PLANNER_GMAIL_REFRESH_TOKEN", "HOUSE_PLANNER_GOOGLE_CLIENT_SECRET", "HOUSE_PLANNER_GOOGLE_TOKEN_KEY"].some((key) => clean(env[key]))) throw new Error("QA cannot load live email or Google OAuth credentials");
  return { projectId, storageBucket, isQa: true, isEmulator };
}

export function assertIsolatedQaEnvironment(env = process.env) {
  const config = resolveFirebaseEnvironment(env);
  if (!config.isQa) throw new Error("Isolated QA environment required");
  return config;
}

export function assertQaCredentialProject(credentials, config) {
  if (!config.isQa || config.isEmulator) return;
  for (const key of ["project_id", "quota_project_id"]) {
    if (credentials?.[key] && credentials[key] !== config.projectId) throw new Error("QA ADC credential project mismatch");
  }
}

export function validateQaBrowserConfig(config) {
  if (config.environment !== "qa") {
    if (config.environment && config.environment !== "production") throw new Error("Unknown browser environment");
    if (config.projectId === QA_EMULATOR_PROJECT || QA_CLOUD_PROJECT_PATTERN.test(config.projectId) || config.authEmulatorHost) throw new Error("QA browser resources require an explicit QA environment");
    return;
  }
  if (config.projectId !== QA_EMULATOR_PROJECT && !QA_CLOUD_PROJECT_PATTERN.test(config.projectId || "")) throw new Error("QA browser cannot authenticate against production");
  if (!config.apiKey || !config.appId || !config.authDomain || !config.storageBucket) throw new Error("Incomplete QA browser Firebase configuration");
  if (config.authDomain !== `${config.projectId}.firebaseapp.com`) throw new Error("QA browser auth domain mismatch");
  if (!config.storageBucket.startsWith(`${config.projectId}.`) && !config.storageBucket.startsWith(`${config.projectId}-`)) throw new Error("QA browser storage bucket mismatch");
  if (config.projectId === QA_EMULATOR_PROJECT && !loopbackHost.test(config.authEmulatorHost || "")) throw new Error("QA browser Auth emulator is required");
  if (config.projectId !== QA_EMULATOR_PROJECT && config.authEmulatorHost) throw new Error("Cloud QA browser cannot use an Auth emulator");
}
