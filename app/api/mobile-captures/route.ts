import { lockProjectCurrency } from "@/lib/project-currency";
import type { ProjectCurrency } from "@/lib/currency";
import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { getSessionMember } from "@/lib/auth";
import { appendActivity } from "@/lib/activity";
import { completedUsageAction } from "@/lib/usage-actions";
import { firestore, projectBucket } from "@/lib/firebase-admin";
import { buildTopLevelFolderMap, ensureExpenseInvoiceFolder, folderTopLevelId, listProjectFolders } from "@/lib/folders";
import {
  canCreateMobileCapture,
  captureContentType,
  captureFileExtension,
  MOBILE_CAPTURE_AUDIO_TYPES,
  MOBILE_CAPTURE_IMAGE_TYPES,
  mobileCaptureTargetTab,
  normalizeMobileCaptureId,
  normalizeMobileCaptureNote,
  normalizeMobileCaptureTarget,
  type MobileCaptureAttachment,
} from "@/lib/mobile-capture";
import {
  CONFIG,
  DECISIONS,
  DOCUMENTS,
  EXPENSES,
  MOBILE_CAPTURES,
  projectConfigDoc,
  projectScopedId,
  projectStoragePrefix,
  SITE_ISSUES,
} from "@/lib/project";
import { budgetPayload } from "@/lib/workbook-store";

const MAX_PHOTO_BYTES = 15 * 1024 * 1024;
const MAX_VOICE_BYTES = 15 * 1024 * 1024;

type StoredCaptureFile = {
  attachment: MobileCaptureAttachment;
  bytes: Buffer;
  documentRef: FirebaseFirestore.DocumentReference;
  objectKey: string;
  thumbnailObjectKey: string | null;
  folderId: string | null;
};

function captureJson(data: FirebaseFirestore.DocumentData, duplicate = false) {
  return {
    capture: {
      id: String(data.captureId || ""),
      projectId: String(data.projectId || ""),
      targetType: String(data.targetType || ""),
      targetId: String(data.targetId || ""),
      note: String(data.note || ""),
      attachments: Array.isArray(data.attachments) ? data.attachments : [],
    },
    duplicate,
  };
}

async function createThumbnail(bytes: Buffer) {
  return sharp(bytes, { limitInputPixels: 50_000_000 }).rotate().resize(420, 320, { fit: "inside", withoutEnlargement: true }).webp({ quality: 78 }).toBuffer();
}

async function storeCaptureFile({
  actor,
  captureId,
  file,
  kind,
  folderId,
  note,
  createdAt,
}: {
  actor: NonNullable<Awaited<ReturnType<typeof getSessionMember>>>;
  captureId: string;
  file: File;
  kind: "photo" | "voice";
  folderId: string | null;
  note: string;
  createdAt: string;
}): Promise<StoredCaptureFile> {
  if (!projectBucket) throw new Error("storage_unavailable");
  const contentType = captureContentType(file.type);
  const extension = captureFileExtension(contentType);
  const documentId = projectScopedId(actor.projectId, `mobile-${captureId}-${kind}`);
  const documentRef = firestore.collection(DOCUMENTS).doc(documentId);
  const fileName = `${kind === "photo" ? "captura-obra" : "nota-voz"}-${createdAt.replace(/[:.]/g, "-")}.${extension}`;
  const objectKey = `${projectStoragePrefix(actor.projectId)}/documents/${documentId}-${randomUUID()}-${fileName}`;
  const bytes = Buffer.from(await file.arrayBuffer());
  await projectBucket.file(objectKey).save(bytes, {
    contentType,
    metadata: { metadata: { uploadedBy: actor.email, originalName: fileName, source: "mobile_capture", captureId } },
    resumable: false,
  });
  let thumbnailObjectKey: string | null = null;
  if (kind === "photo") {
    try {
      const thumbnail = await createThumbnail(bytes);
      thumbnailObjectKey = `${projectStoragePrefix(actor.projectId)}/thumbnails/${documentId}-${randomUUID()}.webp`;
      await projectBucket.file(thumbnailObjectKey).save(thumbnail, { contentType: "image/webp", resumable: false });
    } catch {
      thumbnailObjectKey = null;
    }
  }
  return {
    attachment: { captureId, documentId, folderId, fileName, contentType, note, createdAt },
    bytes,
    documentRef,
    objectKey,
    thumbnailObjectKey,
    folderId,
  };
}

export async function POST(request: Request) {
  const actor = await getSessionMember();
  if (!actor || actor.status !== "approved") return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  if (!projectBucket) return NextResponse.json({ error: "Storage is unavailable" }, { status: 503 });
  const bucket = projectBucket;

  const form = await request.formData();
  const captureId = normalizeMobileCaptureId(form.get("captureId"));
  const targetType = normalizeMobileCaptureTarget(form.get("targetType"));
  const targetId = typeof form.get("targetId") === "string" ? String(form.get("targetId")).trim().slice(0, 200) : "";
  const projectId = typeof form.get("projectId") === "string" ? String(form.get("projectId")).trim() : "";
  const note = normalizeMobileCaptureNote(form.get("note"));
  const photo = form.get("photo");
  const voice = form.get("voice");
  if (!captureId || !targetType || !targetId || !(photo instanceof File))
    return NextResponse.json({ error: "Capture, photo, and destination are required" }, { status: 400 });
  if (projectId !== actor.projectId || actor.isPersonal)
    return NextResponse.json({ error: "The selected shared project is not active" }, { status: 409 });
  if (!canCreateMobileCapture(actor, targetType))
    return NextResponse.json({ error: "Capture access required" }, { status: 403 });
  const photoType = captureContentType(photo.type);
  if (!MOBILE_CAPTURE_IMAGE_TYPES.has(photoType))
    return NextResponse.json({ error: "The cropped photo must be JPEG, PNG, or WebP" }, { status: 415 });
  if (photo.size <= 0 || photo.size > MAX_PHOTO_BYTES)
    return NextResponse.json({ error: "Photos are limited to 15 MB" }, { status: 413 });
  if (voice instanceof File) {
    const voiceType = captureContentType(voice.type);
    if (!MOBILE_CAPTURE_AUDIO_TYPES.has(voiceType))
      return NextResponse.json({ error: "This voice-note format is not supported" }, { status: 415 });
    if (voice.size <= 0 || voice.size > MAX_VOICE_BYTES)
      return NextResponse.json({ error: "Voice notes are limited to 15 MB" }, { status: 413 });
  }

  const captureRef = firestore.collection(MOBILE_CAPTURES).doc(projectScopedId(actor.projectId, captureId));
  const existing = await captureRef.get();
  if (existing.exists && existing.data()?.projectId === actor.projectId)
    return NextResponse.json(captureJson(existing.data()!, true));

  const targetTab = mobileCaptureTargetTab(targetType);
  const folders = await listProjectFolders(actor.projectId);
  const ordinaryFolderMap = buildTopLevelFolderMap(folders);
  let folderId: string | null = null;
  if (targetType === "expense") {
    const invoiceFolder = await ensureExpenseInvoiceFolder(actor.projectId, actor.email);
    folderId = invoiceFolder.id;
    if (!folders.some((folder) => folder.id === invoiceFolder.id)) folders.push(invoiceFolder);
  } else if (actor.role !== "admin" && actor.folderAccess.mode === "selected" && !actor.folderAccess.allowUnfiled) {
    folderId = actor.folderAccess.folderIds.find((id) => folders.some((folder) => folder.id === id)
      && !folders.some((folder) => folder.id === folderTopLevelId(id, ordinaryFolderMap) && folder.encrypted === true)) || null;
    if (!folderId) return NextResponse.json({ error: "An accessible document folder is required" }, { status: 403 });
  }
  const topLevelMap = buildTopLevelFolderMap(folders);
  if (folders.some((folder) => folder.id === folderTopLevelId(folderId, topLevelMap) && folder.encrypted === true))
    return NextResponse.json({ error: "Encrypted folders must be uploaded from Documents" }, { status: 409 });
  const visibilityFolderId = folderTopLevelId(folderId, topLevelMap);

  let targetRef: FirebaseFirestore.DocumentReference | null = null;
  let targetLabel = "";
  let currency: ProjectCurrency | undefined;
  let expenseLine: Awaited<ReturnType<typeof budgetPayload>>["lines"][number] | null = null;
  if (targetType === "expense") {
    currency = await lockProjectCurrency(actor.projectId);
    const budget = await budgetPayload(actor.projectId);
    expenseLine = budget.lines.find((line) => line.id === targetId && line.paid > 0) || null;
    if (!expenseLine) return NextResponse.json({ error: "The expense must have a paid price in Excel" }, { status: 404 });
    targetLabel = expenseLine.item;
  } else {
    targetRef = firestore.collection(targetType === "decision" ? DECISIONS : SITE_ISSUES).doc(targetId);
    const target = await targetRef.get();
    if (!target.exists || target.data()?.projectId !== actor.projectId)
      return NextResponse.json({ error: "Capture destination not found" }, { status: 404 });
    targetLabel = String(target.data()?.title || (targetType === "decision" ? "Decision" : "Progress entry")).slice(0, 300);
  }

  const createdAt = new Date().toISOString();
  const stored: StoredCaptureFile[] = [];
  try {
    stored.push(await storeCaptureFile({ actor, captureId, file: photo, kind: "photo", folderId, note, createdAt }));
    if (voice instanceof File) stored.push(await storeCaptureFile({ actor, captureId, file: voice, kind: "voice", folderId, note, createdAt }));
    const attachments = stored.map((item) => item.attachment);
    let duplicate = false;
    await firestore.runTransaction(async (transaction) => {
      const [captureSnapshot, targetSnapshot] = await Promise.all([
        transaction.get(captureRef),
        targetRef ? transaction.get(targetRef) : Promise.resolve(null),
      ]);
      if (captureSnapshot.exists) {
        duplicate = true;
        return;
      }
      if (targetRef && (!targetSnapshot?.exists || targetSnapshot.data()?.projectId !== actor.projectId))
        throw new Error("capture_destination_changed");
      await appendActivity(transaction, actor, {
        category: targetType === "expense" ? "expense" : targetType === "decision" ? "decision" : "site",
        action: `${targetType}.mobile_capture_added`,
        target: { type: targetType, id: targetId, label: targetLabel, section: targetTab },
        summaryParams: { attachmentCount: attachments.length, hasVoice: attachments.some((item) => item.contentType.startsWith("audio/")), hasNote: Boolean(note) },
        changes: [
          { field: "attachments", before: [], after: attachments.map((item) => item.fileName), format: "list" },
          ...(note ? [{ field: "note", before: null, after: note, format: "text" as const }] : []),
        ],
        visibility: targetType === "expense"
          ? { requiredTabs: ["expenses"] }
          : { requiredTabs: [targetTab, "documents"], folderTopLevelId: visibilityFolderId, allowUnfiledRequired: !folderId },
      });
      for (const item of stored) transaction.set(item.documentRef, {
        projectId: actor.projectId,
        objectKey: item.objectKey,
        fileName: item.attachment.fileName,
        contentType: item.attachment.contentType,
        size: item.bytes.length,
        folderId,
        uploadedBy: actor.email,
        description: note,
        source: "mobile_capture",
        captureId,
        createdAt: FieldValue.serverTimestamp(),
        thumbnailObjectKey: item.thumbnailObjectKey,
        aiIndexStatus: "unsupported",
      });
      if (targetRef) transaction.set(targetRef, {
        captureAttachments: FieldValue.arrayUnion(...attachments),
        updatedBy: actor.email,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      if (targetType === "expense" && expenseLine) {
        for (const item of stored) {
          const linkRef = firestore.collection(EXPENSES).doc(projectScopedId(actor.projectId, `mobile-${captureId}-${item.attachment.documentId}`));
          transaction.set(linkRef, {
            projectId: actor.projectId,
            kind: "workbook_receipt_link",
            budgetLineId: targetId,
            receiptDocumentId: item.attachment.documentId,
            amountSnapshot: expenseLine.paid, currency,
            descriptionSnapshot: expenseLine.item,
            captureId,
            captureNote: note,
            createdBy: actor.email,
            createdAt: FieldValue.serverTimestamp(),
            updatedBy: actor.email,
            updatedAt: FieldValue.serverTimestamp(),
            deletedAt: null,
          });
        }
      }
      transaction.set(captureRef, {
        projectId: actor.projectId,
        captureId,
        targetType,
        targetId,
        note,
        attachments,
        createdBy: actor.email,
        createdAt: FieldValue.serverTimestamp(),
      });
      transaction.set(firestore.collection(CONFIG).doc(projectConfigDoc(actor.projectId)), {
        projectId: actor.projectId,
        documentsVersion: FieldValue.increment(1),
        documentsUpdatedAt: FieldValue.serverTimestamp(),
        documentsUpdatedBy: actor.email,
        documentsUpdatedFolderIds: [folderId],
      }, { merge: true });
    });
    if (duplicate) {
      await Promise.all(stored.flatMap((item) => [
        bucket.file(item.objectKey).delete({ ignoreNotFound: true }).catch(() => undefined),
        ...(item.thumbnailObjectKey ? [bucket.file(item.thumbnailObjectKey).delete({ ignoreNotFound: true }).catch(() => undefined)] : []),
      ]));
      const winner = await captureRef.get();
      return NextResponse.json(captureJson(winner.data() || {}, true));
    }
    await completedUsageAction(actor, "file.upload", targetTab, captureId);
    return NextResponse.json(captureJson({ projectId: actor.projectId, captureId, targetType, targetId, note, attachments }), { status: 201 });
  } catch (error) {
    await Promise.all(stored.flatMap((item) => [
      bucket.file(item.objectKey).delete({ ignoreNotFound: true }).catch(() => undefined),
      ...(item.thumbnailObjectKey ? [bucket.file(item.thumbnailObjectKey).delete({ ignoreNotFound: true }).catch(() => undefined)] : []),
    ]));
    if (error instanceof Error && error.message === "capture_destination_changed")
      return NextResponse.json({ error: "Capture destination changed; please select it again" }, { status: 409 });
    throw error;
  }
}
