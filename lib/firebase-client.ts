"use client";

import { getApp, getApps, initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth } from "firebase/auth";
import { validateQaBrowserConfig } from "./qa-environment.mjs";

const environment = process.env.NEXT_PUBLIC_HOUSE_PLANNER_ENVIRONMENT;
const authEmulatorHost = process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST;
const qa = environment === "qa";
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || (qa ? "" : "example-browser-key"),
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || (qa ? "" : "example-house-planner.firebaseapp.com"),
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || (qa ? "" : "example-house-planner"),
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || (qa ? "" : "example-house-planner.firebasestorage.app"),
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || (qa ? "" : "000000000000"),
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || (qa ? "" : "example-browser-app"),
};

validateQaBrowserConfig({ ...firebaseConfig, environment, authEmulatorHost });
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
if (qa && app.options.projectId !== firebaseConfig.projectId) throw new Error("QA browser Firebase app project mismatch");
export const firebaseAuth = getAuth(app);
if (authEmulatorHost && !firebaseAuth.emulatorConfig) connectAuthEmulator(firebaseAuth, `http://${authEmulatorHost}`, { disableWarnings: true });

