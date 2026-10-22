import { aestheticId } from "./aesthetics";

export const OVERVIEW_IMAGE_LIMIT = 30;
export const OVERVIEW_NOTE_LIMIT = 12;

export type OverviewPreferences = { imageIds: string[]; noteIds: string[] };
export type OverviewUpdate = Partial<OverviewPreferences>;

function noteId(value: unknown) {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{1,200}$/.test(value) ? value : "";
}

function normalizeIds(value: unknown, validId: (value: unknown) => string, limit: number) {
  return Array.isArray(value) ? [...new Set(value.map(validId).filter(Boolean))].slice(0, limit) : [];
}

export function normalizeOverviewPreferences(value: unknown): OverviewPreferences {
  const data = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    imageIds: normalizeIds(data.overviewImageIds, aestheticId, OVERVIEW_IMAGE_LIMIT),
    noteIds: normalizeIds(data.overviewNoteIds, noteId, OVERVIEW_NOTE_LIMIT),
  };
}

export function parseOverviewUpdate(value: unknown): OverviewUpdate | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const data = value as Record<string, unknown>;
  const keys = Object.keys(data);
  if (!keys.length || keys.some((key) => key !== "imageIds" && key !== "noteIds")) return null;
  const update: OverviewUpdate = {};
  for (const key of keys as (keyof OverviewPreferences)[]) {
    const ids = data[key];
    const validId = key === "imageIds" ? aestheticId : noteId;
    const limit = key === "imageIds" ? OVERVIEW_IMAGE_LIMIT : OVERVIEW_NOTE_LIMIT;
    if (!Array.isArray(ids) || ids.length > limit || ids.some((id) => !validId(id))) return null;
    update[key] = [...new Set(ids as string[])];
  }
  return update;
}
