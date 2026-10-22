import JSZip from "jszip";
import type { File as StorageFile } from "@google-cloud/storage";
import { NextResponse } from "next/server";
import { requireTabAccess } from "@/lib/auth";
import { firestore, projectBucket } from "@/lib/firebase-admin";
import { aestheticId, AESTHETIC_IMAGE_TYPES } from "@/lib/aesthetics";
import { AESTHETIC_FOLDERS, AESTHETIC_IMAGES } from "@/lib/project";
import { AestheticArchiveError, AESTHETIC_ARCHIVE_MAX_BYTES, AESTHETIC_ARCHIVE_MAX_IMAGE_BYTES, aestheticArchiveImagePath, claimAestheticArchiveMemory, planAestheticArchive } from "@/lib/aesthetic-archive";

export const runtime = "nodejs";

async function readOriginal(file: StorageFile, size: number, signal: AbortSignal) {
  const stream = file.createReadStream({ decompress: false });
  const abort = () => stream.destroy(new AestheticArchiveError("La descarga se canceló antes de completar el ZIP.", 503));
  signal.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(() => stream.destroy(new AestheticArchiveError("No se pudo leer una imagen a tiempo. Inténtalo de nuevo.", 503)), 30_000);
  timeout.unref();
  let received = 0;
  const chunks: Buffer[] = [];
  try {
    if (signal.aborted) throw new AestheticArchiveError("La descarga se canceló antes de completar el ZIP.", 503);
    for await (const chunk of stream) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      received += bytes.length;
      if (received > AESTHETIC_ARCHIVE_MAX_IMAGE_BYTES) throw new AestheticArchiveError("Una imagen supera el límite de 15 MB. No se generó el ZIP.", 413);
      if (received > size) throw new AestheticArchiveError("Una imagen cambió durante la descarga. No se generó el ZIP.", 503);
      chunks.push(bytes);
    }
    if (received !== size) throw new AestheticArchiveError("No se pudo leer una imagen completa. No se generó el ZIP.", 503);
    return Buffer.concat(chunks, received);
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", abort);
    stream.destroy();
  }
}

function archiveBody(bytes: Uint8Array, release: () => void, signal: AbortSignal) {
  let content: Uint8Array | null = bytes;
  let offset = 0;
  let output: ReadableStreamDefaultController<Uint8Array>;
  const finish = () => {
    content = null;
    signal.removeEventListener("abort", abort);
    release();
  };
  const abort = () => {
    finish();
    output.error(new Error("La descarga ZIP se canceló."));
  };
  return new ReadableStream<Uint8Array>({
    start(controller) {
      output = controller;
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    },
    pull(controller) {
      if (!content) { controller.close(); return; }
      const end = Math.min(offset + 64 * 1024, content.byteLength);
      // Copy only the outgoing chunk so a queued last chunk cannot retain the
      // whole ZIP after transmission finishes. Never copy another full archive.
      controller.enqueue(new Uint8Array(content.subarray(offset, end)));
      offset = end;
      if (offset === content.byteLength) { finish(); controller.close(); }
    },
    cancel() { finish(); },
  }, { highWaterMark: 0 });
}

export async function GET(request: Request) {
  const actor = await requireTabAccess("aesthetics");
  if (!actor) return NextResponse.json({ error: "Necesitas acceso a Estética para descargar las imágenes." }, { status: 403 });
  const folderId = aestheticId(new URL(request.url).searchParams.get("folderId"));
  if (!folderId) return NextResponse.json({ error: "Selecciona una carpeta válida para descargar." }, { status: 400 });
  if (!projectBucket) return NextResponse.json({ error: "El almacenamiento de imágenes no está disponible." }, { status: 503 });
  let releaseMemory: (() => void) | null = null;
  let body: ReadableStream<Uint8Array> | null = null;
  try {
    const [folders, images] = await Promise.all([
      firestore.collection(AESTHETIC_FOLDERS).where("projectId", "==", actor.projectId).get(),
      firestore.collection(AESTHETIC_IMAGES).where("projectId", "==", actor.projectId).get(),
    ]);
    const plan = planAestheticArchive(actor.projectId, folderId, folders.docs.map(doc => ({ id: doc.id, data: doc.data() })), images.docs.map(doc => ({ id: doc.id, data: doc.data() })));
    const originals: { file: StorageFile; size: number; path: string }[] = [];
    let totalBytes = 0;
    // Validate every object before transferring image bytes. Four independent
    // metadata reads at a time keep the preflight bounded for large folders.
    for (let offset = 0; offset < plan.images.length; offset += 4) {
      const batch = await Promise.all(plan.images.slice(offset, offset + 4).map(async image => {
        const [metadata] = await projectBucket!.file(image.objectKey).getMetadata();
        const size = Number(metadata.size);
        const contentType = String(metadata.contentType || "").toLowerCase();
        const generation = String(metadata.generation || "");
        if (!Number.isSafeInteger(size) || size <= 0 || !AESTHETIC_IMAGE_TYPES.has(contentType) || !/^[0-9]+$/.test(generation) || (metadata.contentEncoding && metadata.contentEncoding !== "identity")) throw new AestheticArchiveError("No se pudo verificar una imagen original. No se generó el ZIP.", 503);
        if (size > AESTHETIC_ARCHIVE_MAX_IMAGE_BYTES) throw new AestheticArchiveError("Una imagen supera el límite de 15 MB. No se generó el ZIP.", 413);
        // Pin the original to the generation whose size and media type we read.
        return { file: projectBucket!.file(image.objectKey, { generation }), size, image, contentType };
      }));
      for (const original of batch) {
        totalBytes += original.size;
        if (totalBytes > AESTHETIC_ARCHIVE_MAX_BYTES) throw new AestheticArchiveError("El ZIP admite hasta 100 MB de imágenes. Descarga las subcarpetas por separado.", 413);
        originals.push({ file: original.file, size: original.size, path: aestheticArchiveImagePath(plan, original.image, original.contentType) });
      }
    }
    releaseMemory = claimAestheticArchiveMemory(totalBytes);
    let zip: JSZip | null = new JSZip();
    for (const original of originals) zip.file(original.path, await readOriginal(original.file, original.size, request.signal));
    // JPEG/WebP/AVIF/PNG originals are already compressed. STORE avoids wasting
    // CPU and keeps the bounded in-memory archive predictable.
    const bytes = await zip.generateAsync({ type: "uint8array", compression: "STORE", streamFiles: true });
    zip = null;
    originals.length = 0;
    const filename = encodeURIComponent(plan.filename).replace(/['()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
    body = archiveBody(bytes, releaseMemory, request.signal);
    const response = new Response(body, { headers: {
      "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="imagenes.zip"; filename*=UTF-8''${filename}`,
      "Content-Length": String(bytes.byteLength), "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
    } });
    // Ownership passes to the body: retain the aggregate allowance until its
    // final read or cancellation, including client aborts during transmission.
    releaseMemory = null;
    return response;
  } catch (error) {
    if (body) await body.cancel().catch(() => undefined);
    releaseMemory?.();
    if (error instanceof AestheticArchiveError) return NextResponse.json({ error: error.message }, { status: error.status, headers: error.status === 429 ? { "Retry-After": "3" } : undefined });
    return NextResponse.json({ error: "No se pudo completar la descarga de todas las imágenes. No se generó el ZIP. Inténtalo de nuevo." }, { status: 503 });
  }
}
