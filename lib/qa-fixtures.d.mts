import type { Auth } from "firebase-admin/auth";
import type { Firestore } from "firebase-admin/firestore";
import type { Bucket } from "@google-cloud/storage";
export const QA_FIXTURE_VERSION: number;
export type QaIdentity = { key: string; email: string; name: string; role: "admin" | "editor" | "viewer"; projectId: string; passwordEnv: string };
export const QA_IDENTITIES: readonly QaIdentity[];
export const QA_FIXTURE_IDS: Readonly<Record<"visibleFolder" | "hiddenFolder" | "visibleDocument" | "hiddenDocument" | "primaryNote" | "isolationNote" | "isolationDocument", string>>;
export function qaIdentityMembership(identity: QaIdentity, uid: string): Record<string, unknown>;
export function seedQaFixtures(input: { auth: Auth; firestore: Firestore; bucket: Bucket | null; provisionAuth?: boolean; env?: Record<string, string | undefined> }): Promise<{ fixtureVersion: number; projectIds: string[]; fixtures: typeof QA_FIXTURE_IDS; users: { key: string; email: string; uid: string; role: string; projectId: string }[] }>;
