import type { MemberRecord, WorkspaceTab } from "./project";

export const MOBILE_CAPTURE_TARGETS = ["expense", "site_issue", "decision"] as const;
export type MobileCaptureTarget = (typeof MOBILE_CAPTURE_TARGETS)[number];

export type MobileCaptureAttachment = {
  captureId: string;
  documentId: string;
  folderId: string | null;
  fileName: string;
  contentType: string;
  note: string;
  createdAt?: string;
};

const TARGET_TABS: Record<MobileCaptureTarget, WorkspaceTab> = {
  expense: "expenses",
  site_issue: "site",
  decision: "decisions",
};

export function normalizeMobileCaptureId(value: unknown) {
  const id = typeof value === "string" ? value.trim() : "";
  return /^[a-zA-Z0-9][a-zA-Z0-9_-]{15,99}$/.test(id) ? id : "";
}

export function normalizeMobileCaptureTarget(value: unknown): MobileCaptureTarget | null {
  return MOBILE_CAPTURE_TARGETS.includes(value as MobileCaptureTarget) ? value as MobileCaptureTarget : null;
}

export function normalizeMobileCaptureNote(value: unknown) {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 500)
    : "";
}

export function mobileCaptureTargetTab(target: MobileCaptureTarget) {
  return TARGET_TABS[target];
}

export function canCreateMobileCapture(actor: Pick<MemberRecord, "role" | "permissions" | "isPersonal">, target: MobileCaptureTarget) {
  if (actor.isPersonal || actor.role === "viewer") return false;
  const targetAllowed = actor.role === "admin" || actor.permissions[TARGET_TABS[target]];
  if (target === "expense") return targetAllowed && actor.role === "admin";
  const documentsAllowed = actor.role === "admin" || actor.permissions.documents;
  return documentsAllowed && targetAllowed;
}

export function captureContentType(value: unknown) {
  return String(value || "").split(";", 1)[0].trim().toLowerCase();
}

export const MOBILE_CAPTURE_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
export const MOBILE_CAPTURE_AUDIO_TYPES = new Set(["audio/webm", "audio/mp4", "audio/mpeg", "audio/ogg", "audio/wav", "audio/x-wav"]);

export function captureFileExtension(contentType: string) {
  return ({
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "audio/webm": "webm",
    "audio/mp4": "m4a",
    "audio/mpeg": "mp3",
    "audio/ogg": "ogg",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
  } as Record<string, string>)[captureContentType(contentType)] || "bin";
}

export function normalizeCaptureAttachments(value: unknown): MobileCaptureAttachment[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const item = entry as Record<string, unknown>;
    const captureId = normalizeMobileCaptureId(item.captureId);
    const documentId = typeof item.documentId === "string" ? item.documentId.slice(0, 200) : "";
    const folderId = typeof item.folderId === "string" ? item.folderId.slice(0, 200) : null;
    const fileName = typeof item.fileName === "string" ? item.fileName.slice(0, 240) : "";
    const contentType = captureContentType(item.contentType);
    if (!captureId || !documentId || !fileName) return [];
    return [{ captureId, documentId, folderId, fileName, contentType, note: normalizeMobileCaptureNote(item.note), ...(typeof item.createdAt === "string" ? { createdAt: item.createdAt.slice(0, 40) } : {}) }];
  }).slice(0, 100);
}
