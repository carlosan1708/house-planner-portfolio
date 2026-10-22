import { describe, expect, it } from "vitest";
import { assertIsolatedQaEnvironment, assertQaCredentialProject, resolveFirebaseEnvironment, validateQaBrowserConfig } from "@/lib/qa-environment.mjs";

const cloud = { HOUSE_PLANNER_ENVIRONMENT: "qa", GOOGLE_CLOUD_PROJECT: "house-planner-qa-example", HOUSE_PLANNER_BUCKET: "house-planner-qa-example-files" };
const emulator = { HOUSE_PLANNER_ENVIRONMENT: "qa", GOOGLE_CLOUD_PROJECT: "demo-house-planner-qa", HOUSE_PLANNER_BUCKET: "demo-house-planner-qa.appspot.com", FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099", FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080", FIREBASE_STORAGE_EMULATOR_HOST: "127.0.0.1:9199" };

describe("isolated QA resource boundary", () => {
  it("preserves production defaults and requires explicit QA markers", () => {
    expect(resolveFirebaseEnvironment({}).projectId).toBe("example-house-planner");
    expect(() => assertIsolatedQaEnvironment({})).toThrow("Isolated QA");
    expect(() => resolveFirebaseEnvironment({ ...cloud, HOUSE_PLANNER_ENVIRONMENT: undefined })).toThrow("require HOUSE_PLANNER_ENVIRONMENT");
    expect(() => resolveFirebaseEnvironment({ ...cloud, HOUSE_PLANNER_ENVIRONMENT: "staging" })).toThrow("Unknown");
  });
  it("rejects production and unknown project or bucket before clients initialize", () => {
    expect(assertIsolatedQaEnvironment(cloud).isQa).toBe(true);
    for (const project of ["example-house-planner", "unknown", "house-planner-qa-"]) expect(() => assertIsolatedQaEnvironment({ ...cloud, GOOGLE_CLOUD_PROJECT: project })).toThrow();
    expect(() => assertIsolatedQaEnvironment({ ...cloud, HOUSE_PLANNER_BUCKET: "example-house-planner.firebasestorage.app" })).toThrow("bucket");
    expect(() => assertIsolatedQaEnvironment({ ...cloud, NEXT_PUBLIC_FIREBASE_PROJECT_ID: "example-house-planner" })).toThrow("mismatch");
    expect(() => assertIsolatedQaEnvironment({ ...cloud, GCLOUD_PROJECT: "example-house-planner" })).toThrow("mismatch");
    expect(() => assertIsolatedQaEnvironment({ ...cloud, HOUSE_PLANNER_GMAIL_REFRESH_TOKEN: "production-token" })).toThrow("credentials");
  });
  it("requires all three emulators with loopback hosts and a demo project", () => {
    expect(assertIsolatedQaEnvironment(emulator).isEmulator).toBe(true);
    expect(() => assertIsolatedQaEnvironment({ ...emulator, FIRESTORE_EMULATOR_HOST: undefined })).toThrow("all Auth");
    expect(() => assertIsolatedQaEnvironment({ ...emulator, FIRESTORE_EMULATOR_HOST: "remote.example:8080" })).toThrow("loopback");
    expect(() => assertIsolatedQaEnvironment({ ...cloud, FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099" })).toThrow("mix");
  });
  it("refuses ADC billed or service-account projects outside QA", () => {
    const config = assertIsolatedQaEnvironment(cloud);
    expect(() => assertQaCredentialProject({ project_id: cloud.GOOGLE_CLOUD_PROJECT }, config)).not.toThrow();
    expect(() => assertQaCredentialProject({ project_id: "example-house-planner" }, config)).toThrow("ADC");
    expect(() => assertQaCredentialProject({ quota_project_id: "example-house-planner" }, config)).toThrow("ADC");
  });
  it("fails closed in the browser instead of falling back to production auth", () => {
    const config = { environment: "qa", projectId: cloud.GOOGLE_CLOUD_PROJECT, apiKey: "qa-key", appId: "qa-app", authDomain: `${cloud.GOOGLE_CLOUD_PROJECT}.firebaseapp.com`, storageBucket: cloud.HOUSE_PLANNER_BUCKET };
    expect(() => validateQaBrowserConfig(config)).not.toThrow();
    expect(() => validateQaBrowserConfig({ ...config, projectId: "example-house-planner" })).toThrow("production");
    expect(() => validateQaBrowserConfig({ ...config, apiKey: "" })).toThrow("Incomplete");
    expect(() => validateQaBrowserConfig({ ...config, environment: undefined })).toThrow("explicit QA");
    expect(() => validateQaBrowserConfig({ ...config, authDomain: "example-house-planner.firebaseapp.com" })).toThrow("auth domain");
  });
});
