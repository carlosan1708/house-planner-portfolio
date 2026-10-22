import { describe, expect, it } from "vitest";
import { aestheticClassification, aestheticClassificationLabel, aestheticFolderKind, aestheticFolderPath, aestheticId, aestheticImageIds, aestheticName, aestheticNotes, isAestheticImageClassification, AESTHETIC_IMAGE_TYPES, AESTHETIC_PDF_TYPE, DEFAULT_AESTHETIC_FOLDERS, MAX_AESTHETIC_NOTES_LENGTH } from "@/lib/aesthetics";

describe("aesthetic metadata", () => {
  it("only classifies images from an explicit supported value and leaves legacy data unclassified", () => {
    for (const value of [undefined, null, "Exterior", "design", {}, " planned "]) {
      expect(aestheticClassification(value)).toBe("unclassified");
      expect(isAestheticImageClassification(value)).toBe(false);
    }
    for (const value of ["planned", "inspiration", "unclassified"] as const) {
      expect(aestheticClassification(value)).toBe(value);
      expect(isAestheticImageClassification(value)).toBe(true);
    }
  });

  it("labels planned design, inspiration and unclassified images in both languages", () => {
    expect(aestheticClassificationLabel("planned", "es")).toBe("Diseño previsto");
    expect(aestheticClassificationLabel("inspiration", "es")).toBe("Referencia de inspiración");
    expect(aestheticClassificationLabel(undefined, "es")).toBe("Sin clasificar");
    expect(aestheticClassificationLabel("planned", "en")).toBe("Planned design");
    expect(aestheticClassificationLabel("inspiration", "en")).toBe("Inspiration reference");
    expect(aestheticClassificationLabel(undefined, "en")).toBe("Unclassified");
  });
  it("labels nested folders unambiguously and tolerates old or broken parent references", () => {
    const folders = [{ id: "root", name: "Interior" }, { id: "kitchen", name: "Cocina", parentId: "root" }, { id: "materials", name: "Materiales", parentId: "kitchen" }];
    expect(aestheticFolderPath("materials", folders)).toBe("Interior / Cocina / Materiales");
    expect(aestheticFolderPath("root", folders)).toBe("Interior");
    expect(aestheticFolderPath("unknown", folders)).toBe("");
    expect(aestheticFolderPath("orphan", [{ id: "orphan", name: "Cocina", parentId: "missing" }])).toBe("Cocina");
    expect(aestheticFolderPath("loop", [{ id: "loop", name: "Cocina", parentId: "loop" }])).toBe("Cocina");
  });
  it("sanitizes folder names and captions", () => {
    expect(aestheticName("  Sala\n principal\u0000 ")).toBe("Sala principal");
    expect(aestheticName("123456", 4)).toBe("1234");
  });

  it("preserves multiline notes exactly and permits clearing them", () => {
    const notes = "  Madera clara\n\nComparar con piedra.\r\n  ";
    expect(aestheticNotes(notes)).toBe(notes);
    expect(aestheticNotes("")).toBe("");
    expect(aestheticNotes("a".repeat(MAX_AESTHETIC_NOTES_LENGTH))).toHaveLength(MAX_AESTHETIC_NOTES_LENGTH);
  });

  it("rejects invalid and oversized notes without truncating them", () => {
    for (const notes of [undefined, null, 123, {}, [], "a".repeat(MAX_AESTHETIC_NOTES_LENGTH + 1)]) {
      expect(aestheticNotes(notes)).toBeNull();
    }
  });

  it("accepts safe ids and deduplicates bounded carousel selections", () => {
    expect(aestheticId("folder_123")).toBe("folder_123");
    expect(aestheticId("bad/id")).toBe("");
    expect(aestheticImageIds(["image_123", "image_123", "bad/id", "image_456"])).toEqual(["image_123", "image_456"]);
    expect(aestheticImageIds(Array.from({ length: 40 }, (_, index) => `image_${String(index).padStart(3, "0")}`))).toHaveLength(30);
  });

  it("allows modern browser image formats and identifies plan PDFs", () => {
    expect(AESTHETIC_IMAGE_TYPES.has("image/jpeg")).toBe(true);
    expect(AESTHETIC_IMAGE_TYPES.has("image/avif")).toBe(true);
    expect(AESTHETIC_IMAGE_TYPES.has("image/svg+xml")).toBe(false);
    expect(AESTHETIC_PDF_TYPE).toBe("application/pdf");
    expect(aestheticFolderKind("plans")).toBe("plans");
    expect(aestheticFolderKind(undefined, "Planos")).toBe("plans");
    expect(aestheticFolderKind("images", "Interior")).toBe("images");
  });

  it("starts every empty aesthetic workspace with Interior, Exterior, and Planos", () => {
    expect(DEFAULT_AESTHETIC_FOLDERS).toEqual([
      { key: "interior", name: "Interior", sortOrder: 0, kind: "images" },
      { key: "exterior", name: "Exterior", sortOrder: 1, kind: "images" },
      { key: "plans", name: "Planos", sortOrder: 2, kind: "plans" },
    ]);
  });
});
