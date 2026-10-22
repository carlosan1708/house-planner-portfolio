import { randomUUID } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import sharp from "sharp";
import { commitActivity } from "@/lib/activity";
import { ensureDefaultAestheticFolders } from "@/lib/aesthetic-folders";
import { aestheticClassification, aestheticFolderKind, aestheticId, aestheticImageIds, aestheticName, aestheticNotes, isAestheticImageClassification, AESTHETIC_CAROUSEL_LIMIT, AESTHETIC_IMAGE_TYPES, AESTHETIC_PDF_TYPE, MAX_AESTHETIC_NOTES_LENGTH } from "@/lib/aesthetics";
import { requireTabAccess } from "@/lib/auth";
import { firestore, projectBucket } from "@/lib/firebase-admin";
import { AESTHETIC_FOLDERS, AESTHETIC_IMAGES, projectStoragePrefix } from "@/lib/project";

const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const MAX_PDF_BYTES = 25 * 1024 * 1024;

function iso(value: unknown) {
  return value && typeof value === "object" && "toDate" in value
    ? (value as FirebaseFirestore.Timestamp).toDate().toISOString()
    : new Date(0).toISOString();
}

function folderJson(snapshot: FirebaseFirestore.DocumentSnapshot | FirebaseFirestore.QueryDocumentSnapshot) {
  const data = snapshot.data() || {};
  return { id: snapshot.id, parentId: aestheticId(data.parentId) || null, name: aestheticName(data.name) || "Moodboard", kind: aestheticFolderKind(data.kind, data.name), sortOrder: Number.isFinite(data.sortOrder) ? Number(data.sortOrder) : 1000, carouselImageIds: aestheticImageIds(data.carouselImageIds), createdAt: iso(data.createdAt) };
}

function imageJson(snapshot: FirebaseFirestore.DocumentSnapshot | FirebaseFirestore.QueryDocumentSnapshot) {
  const data = snapshot.data() || {};
  const contentType = data.contentType === AESTHETIC_PDF_TYPE ? AESTHETIC_PDF_TYPE : "image/jpeg";
  return {
    id: snapshot.id,
    folderId: aestheticId(data.folderId),
    name: aestheticName(data.fileName, 240) || "image.jpg",
    caption: aestheticName(data.caption, 300),
    notes: aestheticNotes(data.notes) ?? "",
    classification: aestheticClassification(data.classification),
    width: Number(data.width || 0),
    height: Number(data.height || 0),
    createdAt: iso(data.createdAt),
    mediaType: contentType === AESTHETIC_PDF_TYPE ? "pdf" : "image",
    contentType,
    imageUrl: `/api/aesthetics/image/${encodeURIComponent(snapshot.id)}`,
    thumbnailUrl: contentType === AESTHETIC_PDF_TYPE ? "" : `/api/aesthetics/image/${encodeURIComponent(snapshot.id)}?thumb=1`,
  };
}

export async function GET() {
  const actor = await requireTabAccess("aesthetics");
  if (!actor) return NextResponse.json({ error: "Aesthetics access required" }, { status: 403 });
  await ensureDefaultAestheticFolders(actor.projectId, actor.email);
  const [folders, images] = await Promise.all([
    firestore.collection(AESTHETIC_FOLDERS).where("projectId", "==", actor.projectId).get(),
    firestore.collection(AESTHETIC_IMAGES).where("projectId", "==", actor.projectId).get(),
  ]);
  return NextResponse.json({
    folders: folders.docs.filter((item) => !item.data().deletedAt).map(folderJson).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
    images: images.docs.filter((item) => !item.data().deletedAt).map(imageJson).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request) {
  const actor = await requireTabAccess("aesthetics", ["admin", "editor"]);
  if (!actor) return NextResponse.json({ error: "Aesthetics editor access required" }, { status: 403 });
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const body = await request.json() as { action?: string; name?: unknown; parentId?: unknown };
    if (body.action !== "create_folder") return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
    const name = aestheticName(body.name, 80);
    if (!name) return NextResponse.json({ error: "Folder name is required" }, { status: 400 });
    const parentId = aestheticId(body.parentId) || null;
    if (body.parentId != null && body.parentId !== "" && !parentId) return NextResponse.json({ error: "Invalid parent folder" }, { status: 400 });
    const existing = await firestore.collection(AESTHETIC_FOLDERS).where("projectId", "==", actor.projectId).get();
    const active = existing.docs.filter((item) => !item.data().deletedAt);
    const parent = parentId ? active.find((item) => item.id === parentId) : null;
    if (parentId && !parent) return NextResponse.json({ error: "Parent folder not found" }, { status: 404 });
    if (active.some((item) => (aestheticId(item.data().parentId) || null) === parentId && aestheticName(item.data().name).toLocaleLowerCase() === name.toLocaleLowerCase()))
      return NextResponse.json({ error: "A folder with that name already exists" }, { status: 409 });
    const kind = parent ? aestheticFolderKind(parent.data().kind, parent.data().name) : "images";
    const ref = firestore.collection(AESTHETIC_FOLDERS).doc();
    await commitActivity(actor, {
      category: "aesthetic", action: "aesthetic.folder_created",
      target: { type: "aesthetic_folder", id: ref.id, label: name, section: "aesthetics" },
      changes: [{ field: "name", before: null, after: name, format: "text" }, { field: "parentFolder", before: null, after: parentId, format: "text" }],
    }, (transaction) => transaction.set(ref, { projectId: actor.projectId, parentId, name, kind, sortOrder: 1000, carouselImageIds: [], createdBy: actor.email, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }));
    return NextResponse.json({ folder: folderJson(await ref.get()) }, { status: 201 });
  }

  if (!projectBucket) return NextResponse.json({ error: "Storage is unavailable" }, { status: 503 });
  const form = await request.formData();
  const file = form.get("file");
  const folderId = aestheticId(form.get("folderId"));
  const caption = aestheticName(form.get("caption"), 300);
  if (!(file instanceof File) || !folderId) return NextResponse.json({ error: "File and folder are required" }, { status: 400 });
  const folderRef = firestore.collection(AESTHETIC_FOLDERS).doc(folderId);
  const folder = await folderRef.get();
  if (!folder.exists || folder.data()?.projectId !== actor.projectId || folder.data()?.deletedAt) return NextResponse.json({ error: "Folder not found" }, { status: 404 });
  const folderKind = aestheticFolderKind(folder.data()?.kind, folder.data()?.name);
  const incomingType = file.type.toLowerCase();
  const isPdf = incomingType === AESTHETIC_PDF_TYPE;
  if (folderKind === "plans" && !isPdf) return NextResponse.json({ error: "Planos accepts PDF files" }, { status: 415 });
  if (folderKind === "images" && !AESTHETIC_IMAGE_TYPES.has(incomingType)) return NextResponse.json({ error: "JPEG, PNG, WebP, or AVIF images are supported" }, { status: 415 });
  const maxBytes = isPdf ? MAX_PDF_BYTES : MAX_IMAGE_BYTES;
  if (file.size <= 0 || file.size > maxBytes) return NextResponse.json({ error: isPdf ? "PDF files are limited to 25 MB" : "Images are limited to 15 MB" }, { status: 413 });

  const ref = firestore.collection(AESTHETIC_IMAGES).doc();
  const safeName = (aestheticName(file.name, 180) || "inspiration").replace(/[^a-zA-Z0-9._-]/g, "-");
  const objectKey = isPdf
    ? `${projectStoragePrefix(actor.projectId)}/aesthetics/plans/${ref.id}-${randomUUID()}-${safeName}`
    : `${projectStoragePrefix(actor.projectId)}/aesthetics/${ref.id}-${randomUUID()}-${safeName}.jpg`;
  const thumbnailObjectKey = `${projectStoragePrefix(actor.projectId)}/aesthetics/thumbnails/${ref.id}-${randomUUID()}.webp`;
  let savedOriginal = false;
  let savedThumbnail = false;
  try {
    const input = Buffer.from(await file.arrayBuffer());
    if (isPdf) {
      if (input.subarray(0, 5).toString("ascii") !== "%PDF-") return NextResponse.json({ error: "The selected file is not a valid PDF" }, { status: 415 });
      await projectBucket.file(objectKey).save(input, { contentType: AESTHETIC_PDF_TYPE, resumable: false, metadata: { metadata: { uploadedBy: actor.email, source: "aesthetics-plans" } } });
      savedOriginal = true;
      await commitActivity(actor, {
        category: "aesthetic", action: "aesthetic.image_uploaded",
        target: { type: "aesthetic_image", id: ref.id, label: file.name, section: "aesthetics" },
        summaryParams: { folderName: aestheticName(folder.data()?.name) },
        changes: [{ field: "folder", before: null, after: aestheticName(folder.data()?.name), format: "text" }],
      }, (transaction) => transaction.set(ref, { projectId: actor.projectId, folderId, fileName: file.name, caption, notes: "", objectKey, thumbnailObjectKey: "", contentType: AESTHETIC_PDF_TYPE, size: input.length, width: 0, height: 0, uploadedBy: actor.email, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }));
      return NextResponse.json({ image: imageJson(await ref.get()) }, { status: 201 });
    }
    const normalized = sharp(input, { limitInputPixels: 60_000_000 }).rotate().resize(2400, 2400, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 88, mozjpeg: true });
    const [{ data: image, info }, thumbnail] = await Promise.all([
      normalized.clone().toBuffer({ resolveWithObject: true }),
      normalized.clone().resize(560, 420, { fit: "cover", position: "attention" }).webp({ quality: 80 }).toBuffer(),
    ]);
    await projectBucket.file(objectKey).save(image, { contentType: "image/jpeg", resumable: false, metadata: { metadata: { uploadedBy: actor.email, source: "aesthetics" } } });
    savedOriginal = true;
    await projectBucket.file(thumbnailObjectKey).save(thumbnail, { contentType: "image/webp", resumable: false });
    savedThumbnail = true;
    await commitActivity(actor, {
      category: "aesthetic", action: "aesthetic.image_uploaded",
      target: { type: "aesthetic_image", id: ref.id, label: file.name, section: "aesthetics" },
      summaryParams: { folderName: aestheticName(folder.data()?.name) },
      changes: [{ field: "folder", before: null, after: aestheticName(folder.data()?.name), format: "text" }],
    }, (transaction) => {
      transaction.set(ref, { projectId: actor.projectId, folderId, fileName: file.name, caption, notes: "", classification: "unclassified", objectKey, thumbnailObjectKey, contentType: "image/jpeg", size: image.length, width: info.width, height: info.height, uploadedBy: actor.email, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
      // Uploading files does not change the user's curated carousel selection.
    });
    return NextResponse.json({ image: imageJson(await ref.get()) }, { status: 201 });
  } catch (error) {
    if (savedOriginal) await projectBucket.file(objectKey).delete({ ignoreNotFound: true }).catch(() => undefined);
    if (savedThumbnail) await projectBucket.file(thumbnailObjectKey).delete({ ignoreNotFound: true }).catch(() => undefined);
    throw error;
  }
}

export async function PATCH(request: Request) {
  const actor = await requireTabAccess("aesthetics", ["admin", "editor"]);
  if (!actor) return NextResponse.json({ error: "Aesthetics editor access required" }, { status: 403 });
  const body = await request.json() as { action?: string; id?: unknown; name?: unknown; imageIds?: unknown; folderId?: unknown; caption?: unknown; notes?: unknown; classification?: unknown };
  const id = aestheticId(body.id);
  if (!id) return NextResponse.json({ error: "Item is required" }, { status: 400 });

  if (body.action === "rename_folder" || body.action === "carousel") {
    const ref = firestore.collection(AESTHETIC_FOLDERS).doc(id);
    const current = await ref.get();
    if (!current.exists || current.data()?.projectId !== actor.projectId || current.data()?.deletedAt) return NextResponse.json({ error: "Folder not found" }, { status: 404 });
    if (body.action === "rename_folder") {
      if (!aestheticId(current.data()?.parentId) && aestheticFolderKind(current.data()?.kind, current.data()?.name) === "plans") return NextResponse.json({ error: "The Planos section cannot be renamed" }, { status: 409 });
      const name = aestheticName(body.name, 80);
      if (!name) return NextResponse.json({ error: "Folder name is required" }, { status: 400 });
      if (name === aestheticName(current.data()?.name)) return NextResponse.json({ folder: folderJson(current) });
      const siblings = await firestore.collection(AESTHETIC_FOLDERS).where("projectId", "==", actor.projectId).get();
      if (siblings.docs.some((item) => item.id !== id && !item.data().deletedAt && (aestheticId(item.data().parentId) || null) === (aestheticId(current.data()?.parentId) || null) && aestheticName(item.data().name).toLocaleLowerCase() === name.toLocaleLowerCase()))
        return NextResponse.json({ error: "A folder with that name already exists" }, { status: 409 });
      await commitActivity(actor, {
        category: "aesthetic", action: "aesthetic.folder_renamed",
        target: { type: "aesthetic_folder", id, label: name, section: "aesthetics" },
        changes: [{ field: "name", before: aestheticName(current.data()?.name), after: name, format: "text" }],
      }, (transaction) => transaction.set(ref, { name, updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.email }, { merge: true }));
    } else {
      if (!Array.isArray(body.imageIds) || body.imageIds.length > AESTHETIC_CAROUSEL_LIMIT || body.imageIds.some((imageId) => !aestheticId(imageId)))
        return NextResponse.json({ error: `Choose up to ${AESTHETIC_CAROUSEL_LIMIT} valid carousel items` }, { status: 400 });
      const requested = aestheticImageIds(body.imageIds);
      const images = requested.length ? await firestore.getAll(...requested.map((imageId) => firestore.collection(AESTHETIC_IMAGES).doc(imageId))) : [];
      const isPlans = aestheticFolderKind(current.data()?.kind, current.data()?.name) === "plans";
      const valid = new Set(images.filter((image) => image.exists && image.data()?.projectId === actor.projectId && !image.data()?.deletedAt && (image.data()?.contentType === AESTHETIC_PDF_TYPE) === isPlans).map((image) => image.id));
      if (requested.some((imageId) => !valid.has(imageId))) return NextResponse.json({ error: "One or more carousel items are unavailable or have an incompatible format" }, { status: 400 });
      const selected = requested;
      const before = aestheticImageIds(current.data()?.carouselImageIds);
      if (before.length === selected.length && before.every((imageId, index) => imageId === selected[index]))
        return NextResponse.json({ folder: folderJson(current), unchanged: true });
      await commitActivity(actor, {
        category: "aesthetic", action: "aesthetic.carousel_updated",
        target: { type: "aesthetic_folder", id, label: aestheticName(current.data()?.name), section: "aesthetics" },
        changes: [{ field: "carousel", before, after: selected, format: "list" }],
      }, (transaction) => transaction.set(ref, { carouselImageIds: selected, updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.email }, { merge: true }));
    }
    return NextResponse.json({ folder: folderJson(await ref.get()) });
  }

  if (body.action === "move_image" || body.action === "caption" || body.action === "notes" || body.action === "classification") {
    const ref = firestore.collection(AESTHETIC_IMAGES).doc(id);
    const current = await ref.get();
    if (!current.exists || current.data()?.projectId !== actor.projectId || current.data()?.deletedAt) return NextResponse.json({ error: "Image not found" }, { status: 404 });
    if (body.action === "classification") {
      if (!isAestheticImageClassification(body.classification)) return NextResponse.json({ error: "Choose a valid image classification" }, { status: 400 });
      if (current.data()?.contentType === AESTHETIC_PDF_TYPE) return NextResponse.json({ error: "Classification is available for images only" }, { status: 409 });
      const classification = body.classification;
      const before = aestheticClassification(current.data()?.classification);
      if (before === classification) return NextResponse.json({ image: imageJson(current), unchanged: true });
      await commitActivity(actor, {
        category: "aesthetic", action: "aesthetic.classification_updated",
        target: { type: "aesthetic_image", id, label: aestheticName(current.data()?.fileName, 240), section: "aesthetics" },
        changes: [{ field: "classification", before, after: classification, format: "text" }],
      }, (transaction) => transaction.set(ref, { classification, updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.email }, { merge: true }));
    } else if (body.action === "caption") {
      const caption = aestheticName(body.caption, 300);
      const before = aestheticName(current.data()?.caption, 300);
      if (before === caption) return NextResponse.json({ image: imageJson(current) });
      await commitActivity(actor, {
        category: "aesthetic", action: "aesthetic.caption_updated",
        target: { type: "aesthetic_image", id, label: aestheticName(current.data()?.fileName, 240), section: "aesthetics" },
        changes: [{ field: "caption", before, after: caption, format: "text" }],
      }, (transaction) => transaction.set(ref, { caption, updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.email }, { merge: true }));
    } else if (body.action === "notes") {
      const notes = aestheticNotes(body.notes);
      if (notes === null) return NextResponse.json({ error: `Notes must be text of at most ${MAX_AESTHETIC_NOTES_LENGTH} characters` }, { status: 400 });
      const before = aestheticNotes(current.data()?.notes) ?? "";
      if (before === notes) return NextResponse.json({ image: imageJson(current), unchanged: true });
      await commitActivity(actor, {
        category: "aesthetic", action: "aesthetic.notes_updated",
        target: { type: "aesthetic_image", id, label: aestheticName(current.data()?.fileName, 240), section: "aesthetics" },
        changes: [{ field: "notes", before, after: notes, format: "text" }],
      }, (transaction) => transaction.set(ref, { notes, updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.email }, { merge: true }));
    } else {
      const folderId = aestheticId(body.folderId);
      if (!folderId) return NextResponse.json({ error: "Folder is required" }, { status: 400 });
      if (folderId === aestheticId(current.data()?.folderId)) return NextResponse.json({ image: imageJson(current), unchanged: true });
      const destination = await firestore.collection(AESTHETIC_FOLDERS).doc(folderId).get();
      if (!destination.exists || destination.data()?.projectId !== actor.projectId || destination.data()?.deletedAt) return NextResponse.json({ error: "Folder not found" }, { status: 404 });
      const mediaIsPdf = current.data()?.contentType === AESTHETIC_PDF_TYPE;
      const destinationIsPlans = aestheticFolderKind(destination.data()?.kind, destination.data()?.name) === "plans";
      if (mediaIsPdf !== destinationIsPlans) return NextResponse.json({ error: mediaIsPdf ? "PDF plans must remain in Planos" : "Planos accepts PDF files" }, { status: 409 });
      await commitActivity(actor, {
        category: "aesthetic", action: "aesthetic.image_moved",
        target: { type: "aesthetic_image", id, label: aestheticName(current.data()?.fileName, 240), section: "aesthetics" },
        changes: [{ field: "folder", before: String(current.data()?.folderId || ""), after: folderId, format: "text" }],
      }, (transaction) => {
        transaction.set(ref, { folderId, updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.email }, { merge: true });
      });
    }
    return NextResponse.json({ image: imageJson(await ref.get()) });
  }
  return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
}

export async function DELETE(request: Request) {
  const actor = await requireTabAccess("aesthetics", ["admin", "editor"]);
  if (!actor) return NextResponse.json({ error: "Aesthetics editor access required" }, { status: 403 });
  const url = new URL(request.url);
  const id = aestheticId(url.searchParams.get("id"));
  const type = url.searchParams.get("type");
  if (!id || (type !== "folder" && type !== "image")) return NextResponse.json({ error: "Item is required" }, { status: 400 });
  if (type === "folder") {
    const ref = firestore.collection(AESTHETIC_FOLDERS).doc(id);
    const current = await ref.get();
    if (!current.exists || current.data()?.projectId !== actor.projectId || current.data()?.deletedAt) return NextResponse.json({ error: "Folder not found" }, { status: 404 });
    if (!aestheticId(current.data()?.parentId) && aestheticFolderKind(current.data()?.kind, current.data()?.name) === "plans") return NextResponse.json({ error: "The Planos section cannot be deleted" }, { status: 409 });
    const images = await firestore.collection(AESTHETIC_IMAGES).where("projectId", "==", actor.projectId).get();
    if (images.docs.some((image) => image.data().folderId === id && !image.data().deletedAt)) return NextResponse.json({ error: "Folder is not empty" }, { status: 409 });
    const folders = await firestore.collection(AESTHETIC_FOLDERS).where("projectId", "==", actor.projectId).get();
    if (folders.docs.some((folder) => folder.data().parentId === id && !folder.data().deletedAt))
      return NextResponse.json({ error: "Folder contains subfolders" }, { status: 409 });
    await commitActivity(actor, {
      category: "aesthetic", action: "aesthetic.folder_deleted",
      target: { type: "aesthetic_folder", id, label: aestheticName(current.data()?.name), section: "aesthetics", exists: false },
      changes: [{ field: "deleted", before: false, after: true, format: "status" }],
    }, (transaction) => transaction.set(ref, { deletedAt: FieldValue.serverTimestamp(), deletedBy: actor.email }, { merge: true }));
  } else {
    const ref = firestore.collection(AESTHETIC_IMAGES).doc(id);
    const current = await ref.get();
    if (!current.exists || current.data()?.projectId !== actor.projectId || current.data()?.deletedAt) return NextResponse.json({ error: "Image not found" }, { status: 404 });
    const folders = await firestore.collection(AESTHETIC_FOLDERS).where("projectId", "==", actor.projectId).get();
    const selectedIn = folders.docs.filter((folder) => !folder.data().deletedAt && Array.isArray(folder.data().carouselImageIds) && folder.data().carouselImageIds.includes(id));
    await commitActivity(actor, {
      category: "aesthetic", action: "aesthetic.image_deleted",
      target: { type: "aesthetic_image", id, label: aestheticName(current.data()?.fileName, 240), section: "aesthetics", exists: false },
      changes: [{ field: "deleted", before: false, after: true, format: "status" }],
    }, (transaction) => {
      transaction.set(ref, { deletedAt: FieldValue.serverTimestamp(), deletedBy: actor.email }, { merge: true });
      for (const folder of selectedIn) transaction.set(folder.ref, { carouselImageIds: FieldValue.arrayRemove(id), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    });
  }
  return NextResponse.json({ ok: true });
}
