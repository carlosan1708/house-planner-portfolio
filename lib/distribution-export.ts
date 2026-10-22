import JSZip from "jszip";
import { effectiveModel, modelSources, parseHouseModel, type DistributionRecord } from "./house-distribution";
import { buildDistributionMeasurements, distributionMeasurementsCsv } from "./distribution-export-measurements";
import { buildDistributionPlanSvg } from "./distribution-export-plan";

export type DistributionExportImage = {
  path: "imagenes/planta.png" | "imagenes/vista-3d.png";
  bytes: Uint8Array;
  note: string;
};

export const DISTRIBUTION_EXPORT_IMAGE_MAX_BYTES = 20 * 1024 * 1024;
export const DISTRIBUTION_EXPORT_IMAGE_MAX_SIDE = 4096;
const imagePaths = new Set(["imagenes/planta.png", "imagenes/vista-3d.png"]);
const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];

/** Images are optional visual references; arbitrary attachments and paths are not accepted. */
export function validateDistributionExportImage(image: DistributionExportImage) {
  if (!imagePaths.has(image.path)) throw new Error("Ruta de imagen de exportación no válida.");
  if (!(image.bytes instanceof Uint8Array) || image.bytes.byteLength < 33 || image.bytes.byteLength > DISTRIBUTION_EXPORT_IMAGE_MAX_BYTES) throw new Error("Tamaño de imagen de exportación no válido.");
  const bytes = image.bytes;
  if (!pngSignature.every((value, index) => bytes[index] === value) || String.fromCharCode(...bytes.subarray(12, 16)) !== "IHDR") throw new Error("La imagen de exportación debe ser PNG.");
  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = header.getUint32(16), height = header.getUint32(20);
  if (header.getUint32(8) !== 13 || !width || !height || width > DISTRIBUTION_EXPORT_IMAGE_MAX_SIDE || height > DISTRIBUTION_EXPORT_IMAGE_MAX_SIDE) throw new Error("Dimensiones de imagen de exportación no válidas.");
  if (typeof image.note !== "string" || !image.note.trim() || image.note.length > 2000) throw new Error("Falta una descripción válida de la imagen.");
}

export function distributionExportFilename(name: string, revision: number) {
  const slug = name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase().slice(0, 80) || "casa";
  return `${slug}-interiores-codex-r${revision}.zip`;
}

/** Exports the authorized snapshot, never the viewer's cutaway, hidden layers or selection. */
export function buildDistributionExportFiles(record: DistributionRecord, exportedAt = new Date().toISOString(), images: DistributionExportImage[] = []) {
  if (images.length > 2 || new Set(images.map(image => image.path)).size !== images.length) throw new Error("La exportación admite hasta dos imágenes distintas.");
  images.forEach(validateDistributionExportImage);
  const model = parseHouseModel(effectiveModel(record));
  const original = parseHouseModel(record.model);
  const measurements = buildDistributionMeasurements(model);
  const sources = [...new Map(modelSources(model).map(source => [`${source.documentId}:${source.page}:${source.sheet}`, source])).values()];
  const json = (value: unknown) => JSON.stringify(value, null, 2) + "\n";
  const axes = { x: "De izquierda a derecha en planta", y: "Del frente al fondo de la casa", z: "Elevación hacia arriba; piso de referencia = 0 m" };
  const manifest = {
    exportVersion: 1, purpose: "Diseño de interiores con Codex", name: model.name,
    modelRevision: model.revision, recordRevision: record.revision, updatedAt: record.updatedAt, exportedAt,
    units: { length: "m", area: "m²", slope: "%" }, axes,
    counts: { rooms: model.rooms.length, walls: model.walls.length, openings: model.openings.length, fixtures: model.fixtures.length, measurements: measurements.length },
    files: ["LEEME.md", "modelo.json", "modelo-original.json", "correcciones.json", "medidas.json", "medidas.csv", "planta.svg", "fuentes.json", "manifest.json", ...images.map(image => image.path)],
    images: images.map(image => ({ path: image.path, note: image.note.trim(), recordRevision: record.revision, evidence: "approximate", purpose: "Referencia visual; la geometría y la evidencia de medidas permanecen en modelo.json y medidas.json" })),
    originalBlueprintsIncluded: false,
  };
  const guide = `# Base para diseñar interiores con Codex

Casa: ${model.name}. Modelo ${model.revision}; registro ${record.revision}. Datos guardados: ${record.updatedAt}. Exportación: ${exportedAt}.

Descomprime este ZIP en la carpeta donde trabajarás con Codex. Adjunta LEEME.md, modelo.json, medidas.json y planta.svg al chat, o abre esa carpeta como proyecto. Indica el espacio, estilo, muebles que quieres conservar y presupuesto para comenzar el diseño. La exportación contiene los datos guardados de toda la casa, independientemente de la cámara, el espacio seleccionado o las capas visibles.

## Archivos

- modelo.json: geometría editable y datos efectivos, con las correcciones guardadas. Contiene polígonos de espacios, paredes, puertas, ventanas, instalaciones, superficies, caras de cubierta, apoyos y variantes cuando existen.
- modelo-original.json: modelo preparado antes de correcciones.
- correcciones.json: cambios guardados por identificador, incluidos equipos excluidos; los equipos excluidos no aparecen en modelo.json.
- medidas.json y medidas.csv: catálogo de cotas, coordenadas y cantidades calculadas, con estado, fuente, página y notas. Los valores pendientes se mantienen como null en JSON y vacíos en CSV.
- planta.svg: referencia visual editable de planta; incluye escala métrica, espacios, aberturas e instalaciones.
- fuentes.json: referencias a documentos y páginas. Los PDF originales no se incluyen: puedes descargarlos desde Documentos en House Planner y añadirlos a Codex para revisar los cortes o detalles.
- manifest.json: revisiones, unidades, ejes y conteos de este paquete.
${images.length ? images.map(image => `- ${image.path}: ${image.note.trim()}`).join("\n") + "\n\nLas imágenes son referencias visuales de esta revisión, no planos acotados ni medidas nuevas. La vista 3D puede mostrar recortes, capas o la cámara seleccionada; modelo.json conserva toda la geometría guardada. Usa las imágenes para orientar el diseño y consulta las medidas y sus fuentes en los JSON.\n" : "\nEste paquete no incluye imágenes PNG. planta.svg ofrece la referencia visual editable; modelo.json conserva toda la geometría guardada.\n"}

## Unidades y geometría

Todas las longitudes están en metros y las áreas en m². Los puntos de planta usan [x, y]: X va de izquierda a derecha e Y del frente al fondo. Las caras de la envolvente usan [x, y, elevación], con elevación hacia arriba y piso de referencia 0. Para Three.js, cuya vertical habitual es Y, usa [x, elevación, -y]; para geometría Z-arriba usa [x, y, elevación]. Los opening.offset se miden desde wall.start a lo largo de la pared; el centro en planta es start + (offset + width/2) * dirección. wallId y roomIds enlazan cada abertura con pared y espacios.

Los polígonos siguen zonas trazadas y pueden incluir espesor de pared. Sus extensiones X/Y no son largos de pared ni medidas interiores libres; sus áreas no son áreas netas certificadas. Conserva los vértices y las aberturas al desarrollar el diseño. Algunos espacios y superficies se solapan: no sumes sus áreas como una superficie total. Cada variante de cubierta es una alternativa, no una pieza adicional que deba montarse simultáneamente.

## Evidencia y pendientes

documented = indicado en la fuente; calculated = derivado de geometría; approximate = aproximado; unconfirmed = sin confirmar. Las notas conservan contradicciones entre planos y cortes. modelo.rooms[].height y fixtures[].heightMeasurement guardan la evidencia de altura. null significa que no hay una altura confirmada: no lo sustituyas por cero.

modelo.rooms[].sectionHeight, cuando existe, conserva las alturas mínima y máxima aproximadas bajo la cubierta dibujada en cortes, respecto al piso de referencia. Cada extremo incluye valor, estado, fuente, página y notas. medidas.json y medidas.csv las identifican como minSectionHeight y maxSectionHeight. Este rango no acredita altura libre de cielo raso; room.height mantiene esa evidencia por separado y puede seguir en null.

modelo.envelope.roofUnderside, cuando existe, contiene los triángulos y coordenadas de la cara inferior de cubierta trazada de cortes. Hereda la fuente de envelope.source y se conserva como geometría aproximada distinta de las caras exteriores y de las variantes. No identifica un cielo de gypsum ni confirma su altura libre.

wall.height es una altura de representación, no una altura de cielo raso verificada. fixtures[].height y los soportes de luces son posiciones visuales cuando heightMeasurement está pendiente. Las caras de envolvente, aleros, secciones de apoyos y ciertas posiciones son aproximadas; no conviertas esas ilustraciones en dimensiones constructivas. Los niveles de cubierta no establecen alturas de cielo raso. Las áreas indicadas en areaSchedule permanecen separadas de áreas calculadas de los polígonos.

Como referencia para el trabajo con Codex, conserva la arquitectura capturada y diferencia las propuestas de mobiliario, iluminación y acabados de los datos del plano. Mantén los puntos de electricidad/AC y los pasos de puertas y ventanas visibles al evaluar un diseño; si una propuesta necesita una medida interior o una altura pendiente, indícala como dato por verificar.
`;
  return {
    "LEEME.md": guide,
    "modelo.json": json(model),
    "modelo-original.json": json(original),
    "correcciones.json": json({ recordRevision: record.revision, roomCorrections: record.roomCorrections, fixtureCorrections: record.fixtureCorrections }),
    "medidas.json": json({ units: manifest.units, measurements }),
    "medidas.csv": distributionMeasurementsCsv(measurements),
    "planta.svg": buildDistributionPlanSvg(model),
    "fuentes.json": json({ originalBlueprintsIncluded: false, sourceDocumentIds: model.sourceDocumentIds, references: sources }),
    "manifest.json": json(manifest),
  };
}

export async function buildDistributionExportZip(record: DistributionRecord, images: DistributionExportImage[] = []) {
  const zip = new JSZip();
  const files = buildDistributionExportFiles(record, new Date().toISOString(), images);
  for (const [name, content] of Object.entries(files)) zip.file(name, content);
  for (const image of images) zip.file(image.path, image.bytes, { createFolders: false });
  const bytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  return { bytes, filename: distributionExportFilename(record.model.name, record.model.revision) };
}
