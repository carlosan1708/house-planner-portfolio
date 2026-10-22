import { aestheticId, aestheticName, AESTHETIC_PDF_TYPE } from "./aesthetics";
import { projectStoragePrefix } from "./project";

export const AESTHETIC_ARCHIVE_MAX_IMAGES = 200;
export const AESTHETIC_ARCHIVE_MAX_BYTES = 100 * 1024 * 1024;
export const AESTHETIC_ARCHIVE_MAX_IMAGE_BYTES = 15 * 1024 * 1024;
let reservedArchiveBytes = 0;

export class AestheticArchiveError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

/** Bound aggregate original bytes while archives are prepared and transmitted. */
export function claimAestheticArchiveMemory(bytes: number) {
  if (!Number.isSafeInteger(bytes) || bytes <= 0 || reservedArchiveBytes + bytes > AESTHETIC_ARCHIVE_MAX_BYTES) {
    throw new AestheticArchiveError("Hay otra descarga ZIP preparándose. Espera unos segundos y vuelve a intentarlo.", 429);
  }
  reservedArchiveBytes += bytes;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    reservedArchiveBytes -= bytes;
  };
}
export type AestheticArchiveRow = { id: string; data: Record<string, unknown> };
export type AestheticArchiveImage = { id: string; folderId: string; fileName: string; objectKey: string };

/** A ZIP component, never a filesystem path or an untrusted header value. */
export function aestheticArchiveName(value: unknown, fallback: string) {
  const cleaned = aestheticName(value, 240).normalize("NFKC")
    .replace(/[\\/:*?"<>|\x00-\x1f\x7f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "-")
    .replace(/^\.+/, "").replace(/[.\s]+$/, "").trim().slice(0, 120).replace(/[.\s]+$/, "");
  const name = cleaned || fallback;
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name) ? `_${name}` : name;
}

function uniquePath(directory: string, name: string, claimed: Set<string>, file = false) {
  const extensionAt = file ? name.lastIndexOf(".") : -1;
  const base = extensionAt > 0 ? name.slice(0, extensionAt) : name;
  const extension = extensionAt > 0 ? name.slice(extensionAt) : "";
  let candidate = `${directory}/${name}`;
  for (let index = 2; claimed.has(candidate.toLocaleLowerCase()); index++) candidate = `${directory}/${base} (${index})${extension}`;
  claimed.add(candidate.toLocaleLowerCase());
  return candidate;
}

export function planAestheticArchive(projectId: string, folderId: string, folderRows: AestheticArchiveRow[], imageRows: AestheticArchiveRow[]) {
  const folders = folderRows.filter(row => row.data.projectId === projectId && !row.data.deletedAt);
  const root = folders.find(row => row.id === folderId);
  if (!root) throw new AestheticArchiveError("No se encontró la carpeta para descargar.", 404);
  const rootName = aestheticArchiveName(root.data.name, "Imagenes");
  const directories = new Map([[folderId, rootName]]);
  const claimed = new Set([rootName.toLocaleLowerCase()]);
  const children = new Map<string, AestheticArchiveRow[]>();
  for (const row of folders) {
    const parentId = aestheticId(row.data.parentId);
    if (!parentId) continue;
    const siblings = children.get(parentId) || [];
    siblings.push(row);
    children.set(parentId, siblings);
  }
  // Iteration bounds cyclic legacy trees without a recursive stack. Paths are
  // relative to the requested folder; carousel memberships are never consulted.
  const queue = [folderId];
  for (let index = 0; index < queue.length; index++) {
    const parentId = queue[index];
    for (const child of (children.get(parentId) || []).sort((a, b) => a.id.localeCompare(b.id))) {
      if (directories.has(child.id)) continue;
      const directory = uniquePath(directories.get(parentId)!, aestheticArchiveName(child.data.name, "Carpeta"), claimed);
      if (directory.length > 2048) throw new AestheticArchiveError("La ruta de una subcarpeta es demasiado larga para descargarla en ZIP.", 413);
      directories.set(child.id, directory);
      queue.push(child.id);
    }
  }
  const prefix = `${projectStoragePrefix(projectId)}/aesthetics/`;
  const images: AestheticArchiveImage[] = imageRows
    .filter(row => row.data.projectId === projectId && !row.data.deletedAt && row.data.contentType !== AESTHETIC_PDF_TYPE && row.data.mediaType !== "pdf" && directories.has(aestheticId(row.data.folderId)))
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(row => {
      const objectKey = row.data.objectKey;
      if (typeof objectKey !== "string" || !objectKey.startsWith(prefix) || objectKey.startsWith(`${prefix}thumbnails/`) || objectKey.split("/").some(part => part === ".." || part === ".")) {
        throw new AestheticArchiveError("Una imagen no tiene un archivo original disponible. No se generó el ZIP.", 503);
      }
      return { id: row.id, folderId: aestheticId(row.data.folderId), fileName: aestheticName(row.data.fileName, 240) || row.id, objectKey };
    });
  if (!images.length) throw new AestheticArchiveError("Esta carpeta y sus subcarpetas no tienen imágenes para descargar.", 409);
  if (images.length > AESTHETIC_ARCHIVE_MAX_IMAGES) throw new AestheticArchiveError("El ZIP admite hasta 200 imágenes. Descarga las subcarpetas por separado.", 413);
  return { images, filename: `${rootName}-imagenes.zip`, directories, claimed };
}

export function aestheticArchiveImagePath(plan: Pick<ReturnType<typeof planAestheticArchive>, "directories" | "claimed">, image: AestheticArchiveImage, contentType: string) {
  const extension = ({ "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/avif": ".avif" } as Record<string, string>)[contentType];
  if (!extension) throw new AestheticArchiveError("Una imagen no tiene un formato válido. No se generó el ZIP.", 503);
  const name = aestheticArchiveName(image.fileName, image.id);
  const stem = name.replace(/\.[^.]+$/, "") || image.id;
  return uniquePath(plan.directories.get(image.folderId)!, `${stem}${extension}`, plan.claimed, true);
}
