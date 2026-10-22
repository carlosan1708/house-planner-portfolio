export const QA_EMULATOR_PROJECT: string;
export const QA_PRIMARY_PROJECT: string;
export const QA_ISOLATION_PROJECT: string;
export const QA_CLOUD_PROJECT_PATTERN: RegExp;
export type FirebaseEnvironment = { projectId: string; storageBucket?: string; isQa: boolean; isEmulator: boolean };
export function resolveFirebaseEnvironment(env?: Record<string, string | undefined>): FirebaseEnvironment;
export function assertIsolatedQaEnvironment(env?: Record<string, string | undefined>): FirebaseEnvironment;
export function assertQaCredentialProject(credentials: { project_id?: string; quota_project_id?: string }, config: FirebaseEnvironment): void;
export function validateQaBrowserConfig(config: { environment?: string; projectId?: string; apiKey?: string; appId?: string; authDomain?: string; storageBucket?: string; authEmulatorHost?: string }): void;
