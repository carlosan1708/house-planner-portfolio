import { readFileSync } from "node:fs";
import { applicationDefault, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { Firestore } from "@google-cloud/firestore";
import { Storage } from "@google-cloud/storage";
import { GoogleAuth, OAuth2Client } from "google-auth-library";
import { assertIsolatedQaEnvironment, assertQaCredentialProject } from "../lib/qa-environment.mjs";
import { seedQaFixtures } from "../lib/qa-fixtures.mjs";

const bootstrapToken = process.env.QA_BOOTSTRAP_ACCESS_TOKEN?.trim();
async function seed() {
  const config = assertIsolatedQaEnvironment();
  if (!config.isEmulator && process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    assertQaCredentialProject(JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, "utf8")), config);
  }
  if (config.isEmulator && bootstrapToken) throw new Error("Cloud bootstrap credentials cannot be used with emulators");
  const credential = bootstrapToken
    ? { getAccessToken: async () => ({ access_token: bootstrapToken, expires_in: 3600 }) }
    : applicationDefault();
  const app = initializeApp({ projectId: config.projectId, storageBucket: config.storageBucket, ...(config.isEmulator ? {} : { credential }) });
  let firestore;
  let bucket;
  if (bootstrapToken) {
    // Admin Auth accepts a short-lived credential. Admin Firestore/Storage require ADC
    // or a certificate, so their native clients receive the same in-memory token instead.
    const authClient = new OAuth2Client();
    authClient.setCredentials({ access_token: bootstrapToken, expiry_date: Date.now() + 3_600_000 });
    firestore = new Firestore({ projectId: config.projectId, auth: new GoogleAuth({ projectId: config.projectId, authClient }) });
    const storageAuth = new OAuth2Client();
    storageAuth.setCredentials({ access_token: bootstrapToken, expiry_date: Date.now() + 3_600_000 });
    // Storage 7 embeds google-auth-library 9, which merges plain header objects.
    // Its adapter must not receive the Headers returned by google-auth-library 10.
    storageAuth.getRequestHeaders = async () => ({ Authorization: `Bearer ${bootstrapToken}` });
    bucket = new Storage({ projectId: config.projectId, authClient: storageAuth }).bucket(config.storageBucket);
  } else {
    firestore = getFirestore(app);
    bucket = getStorage(app).bucket();
  }
  try {
    const result = await seedQaFixtures({ auth: getAuth(app), firestore, bucket, provisionAuth: true });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    await firestore.terminate();
  }
}

seed().catch((error) => {
  const message = String(error?.message || "QA fixture provisioning failed");
  process.stderr.write(`${bootstrapToken ? message.replaceAll(bootstrapToken, "[redacted]") : message}\n`);
  process.exitCode = 1;
});
