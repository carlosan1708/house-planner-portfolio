import { effectiveModel, parseHouseModel, type DistributionRecord } from "./house-distribution";
import { buildDistributionPlanSvg } from "./distribution-export-plan";
import {
  DISTRIBUTION_EXPORT_IMAGE_MAX_BYTES,
  DISTRIBUTION_EXPORT_IMAGE_MAX_SIDE,
  validateDistributionExportImage,
  type DistributionExportImage,
} from "./distribution-export";

export type DistributionExportScene = { dataUrl: string; recordRevision: number; view: string };

function sceneImage(scene: DistributionExportScene, revision: number): DistributionExportImage | undefined {
  if (scene.recordRevision !== revision || typeof scene.dataUrl !== "string") return;
  const match = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/.exec(scene.dataUrl);
  if (!match || match[1].length % 4 || match[1].length > Math.ceil(DISTRIBUTION_EXPORT_IMAGE_MAX_BYTES / 3) * 4) return;
  try {
    const decoded = atob(match[1]);
    const bytes = Uint8Array.from(decoded, character => character.charCodeAt(0));
    const view = typeof scene.view === "string" ? scene.view.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 300) : "";
    const result: DistributionExportImage = {
      path: "imagenes/vista-3d.png", bytes,
      note: `Vista 3D del registro ${revision}${view ? `; ${view}` : ""}. Representación aproximada de la cámara y las capas visibles; las alturas pendientes no quedan confirmadas por esta imagen.`,
    };
    validateDistributionExportImage(result);
    return result;
  } catch {
    // An unavailable, oversized or stale scene never prevents the fresh plan export.
    return;
  }
}

/** Called on demand in the browser; importing the ZIP builder in Node requires no DOM. */
export async function createDistributionExportImages(record: DistributionRecord, scene?: DistributionExportScene): Promise<DistributionExportImage[]> {
  if (typeof document === "undefined" || typeof Image === "undefined") throw new Error("Las imágenes de exportación se generan en el navegador.");
  const svg = buildDistributionPlanSvg(parseHouseModel(effectiveModel(record)));
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
  const image = new Image();
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("No se pudo generar la imagen de la planta."));
      image.src = url;
    });
    const width = image.naturalWidth, height = image.naturalHeight;
    if (!width || !height || !Number.isFinite(width) || !Number.isFinite(height)) throw new Error("La planta no tiene dimensiones válidas.");
    const scale = Math.min(2, DISTRIBUTION_EXPORT_IMAGE_MAX_SIDE / width, DISTRIBUTION_EXPORT_IMAGE_MAX_SIDE / height);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.floor(width * scale));
    canvas.height = Math.max(1, Math.floor(height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("No se pudo preparar la imagen de la planta.");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error("No se pudo guardar la imagen PNG de la planta.")), "image/png"));
    const plan: DistributionExportImage = {
      path: "imagenes/planta.png", bytes: new Uint8Array(await blob.arrayBuffer()),
      note: `Planta regenerada del registro ${record.revision}, con las correcciones guardadas. Áreas y dimensiones envolventes calculadas; conserva las alturas pendientes y las fuentes en los JSON.`,
    };
    validateDistributionExportImage(plan);
    const view = scene ? sceneImage(scene, record.revision) : undefined;
    return view ? [plan, view] : [plan];
  } finally {
    image.onload = null;
    image.onerror = null;
    URL.revokeObjectURL(url);
  }
}
