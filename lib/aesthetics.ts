export const AESTHETIC_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);
export const AESTHETIC_PDF_TYPE = "application/pdf";
export const AESTHETIC_CAROUSEL_LIMIT = 30;
export const MAX_AESTHETIC_NOTES_LENGTH = 5000;
export const DEFAULT_AESTHETIC_FOLDERS = [
  { key: "interior", name: "Interior", sortOrder: 0, kind: "images" },
  { key: "exterior", name: "Exterior", sortOrder: 1, kind: "images" },
  { key: "plans", name: "Planos", sortOrder: 2, kind: "plans" },
] as const;

export type AestheticFolderKind = "images" | "plans";
export type AestheticImageClassification = "planned" | "inspiration" | "unclassified";

export function isAestheticImageClassification(value: unknown): value is AestheticImageClassification {
  return value === "planned" || value === "inspiration" || value === "unclassified";
}

export function aestheticClassification(value: unknown): AestheticImageClassification {
  return isAestheticImageClassification(value) ? value : "unclassified";
}

export function aestheticClassificationLabel(value: unknown, language: "en" | "es") {
  const classification = aestheticClassification(value);
  if (classification === "planned") return language === "es" ? "Diseño previsto" : "Planned design";
  if (classification === "inspiration") return language === "es" ? "Referencia de inspiración" : "Inspiration reference";
  return language === "es" ? "Sin clasificar" : "Unclassified";
}

export function aestheticFolderKind(value: unknown, name?: unknown): AestheticFolderKind {
  if (value === "images" || value === "plans") return value;
  return aestheticName(name).toLocaleLowerCase() === "planos" ? "plans" : "images";
}

export function aestheticName(value: unknown, max = 100) {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max)
    : "";
}

export function aestheticNotes(value: unknown) {
  return typeof value === "string" && value.length <= MAX_AESTHETIC_NOTES_LENGTH ? value : null;
}

export function aestheticId(value: unknown) {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{6,220}$/.test(value) ? value : "";
}

export function aestheticImageIds(value: unknown) {
  return Array.isArray(value)
    ? [...new Set(value.map(aestheticId).filter(Boolean))].slice(0, AESTHETIC_CAROUSEL_LIMIT)
    : [];
}

export function aestheticFolderPath(id: string, folders: readonly { id: string; name: string; parentId?: string | null }[]) {
  const names: string[] = [];
  const visited = new Set<string>();
  let current = folders.find((folder) => folder.id === id);
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    names.unshift(current.name);
    current = folders.find((folder) => folder.id === current?.parentId);
  }
  return names.join(" / ");
}
