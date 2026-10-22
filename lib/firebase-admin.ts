import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { readFileSync } from "node:fs";
import { assertQaCredentialProject, resolveFirebaseEnvironment } from "./qa-environment.mjs";

export const firebaseEnvironment = resolveFirebaseEnvironment();
const { projectId, storageBucket, isQa, isEmulator } = firebaseEnvironment;
if (isQa && !isEmulator && process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  assertQaCredentialProject(JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, "utf8")), firebaseEnvironment);
}
const existingApp = getApps()[0];
if (isQa && existingApp && (existingApp.options.projectId !== projectId || existingApp.options.storageBucket !== storageBucket)) {
  throw new Error("QA cannot reuse a Firebase Admin app from another environment");
}

const app = existingApp ?? initializeApp({
  ...(isEmulator ? {} : { credential: applicationDefault() }),
  projectId,
  storageBucket,
});

export const adminAuth = getAuth(app);
export const firestore = getFirestore(app);
export const projectBucket = storageBucket ? getStorage(app).bucket(storageBucket) : null;
