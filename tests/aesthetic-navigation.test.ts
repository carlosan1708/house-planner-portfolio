import { describe, expect, it } from "vitest";
import { aestheticCarouselItems, aestheticChildFolders, aestheticFolderPath, aestheticFolderTrail } from "@/lib/aesthetic-navigation";
import { aestheticFolderKind } from "@/lib/aesthetics";

const folders = [
  { id: "interior", name: "Interior" },
  { id: "exterior", name: "Exterior", parentId: null },
  { id: "kitchen", name: "Cocina", parentId: "interior" },
  { id: "bathrooms", name: "Baños", parentId: "interior" },
  { id: "main-bath", name: "Principal", parentId: "bathrooms" },
];

describe("aesthetic folder navigation", () => {
  it("keeps legacy folders without parentId at the root", () => {
    expect(aestheticChildFolders(folders, null).map((folder) => folder.id)).toEqual(["interior", "exterior"]);
  });
  it("supports multiple siblings and deeper subfolders", () => {
    expect(aestheticChildFolders(folders, "interior").map((folder) => folder.id)).toEqual(["kitchen", "bathrooms"]);
    expect(aestheticChildFolders(folders, "bathrooms").map((folder) => folder.id)).toEqual(["main-bath"]);
    expect(aestheticFolderPath(folders, "main-bath")).toBe("Interior / Baños / Principal");
  });
  it("terminates safely for missing parents and malformed cycles", () => {
    expect(aestheticFolderTrail(folders, "unknown")).toEqual([]);
    expect(aestheticFolderPath([{ id: "orphan", name: "Orphan", parentId: "missing" }], "orphan")).toBe("Orphan");
    const cycle = [{ id: "cycle-a", name: "A", parentId: "cycle-b" }, { id: "cycle-b", name: "B", parentId: "cycle-a" }];
    expect(aestheticFolderTrail(cycle, "cycle-a")).toHaveLength(2);
  });
  it("preserves inherited kinds even when a folder is named Planos", () => {
    expect(aestheticFolderKind("images", "Planos")).toBe("images");
    expect(aestheticFolderKind("plans", "Revisiones")).toBe("plans");
    expect(aestheticFolderKind(undefined, "Planos")).toBe("plans");
  });
});

const images = [
  { id: "image-a", folderId: "kitchen", mediaType: "image" as const },
  { id: "image-b", folderId: "exterior", mediaType: "image" as const },
  { id: "image-c", folderId: "main-bath", mediaType: "image" as const },
  { id: "plan-a", folderId: "plans", mediaType: "pdf" as const },
  { id: "plan-b", folderId: "plans-child", mediaType: "pdf" as const },
];

describe("project-wide aesthetic carousel references", () => {
  it("combines different folders in the requested order without duplicating files", () => {
    const before = structuredClone(images);
    const selected = aestheticCarouselItems(images, ["image-c", "image-b", "image-a"], "images");
    expect(selected.map((image) => image.id)).toEqual(["image-c", "image-b", "image-a"]);
    expect(selected[0]).toBe(images[2]);
    expect(images).toEqual(before);
  });
  it("ignores deleted/missing IDs and deduplicates old selections", () => {
    expect(aestheticCarouselItems(images, ["missing", "image-b", "image-b"], "images").map((image) => image.id)).toEqual(["image-b"]);
  });
  it("does not mix PDFs and images but permits PDFs from plan subfolders", () => {
    expect(aestheticCarouselItems(images, ["plan-a", "image-a"], "images").map((image) => image.id)).toEqual(["image-a"]);
    expect(aestheticCarouselItems(images, ["plan-b", "image-a", "plan-a"], "plans").map((image) => image.id)).toEqual(["plan-b", "plan-a"]);
  });
  it("keeps a selected image after it moves to a different folder", () => {
    const moved = images.map((image) => image.id === "image-a" ? { ...image, folderId: "exterior" } : image);
    expect(aestheticCarouselItems(moved, ["image-a"], "images")).toEqual([moved[0]]);
  });
  it("supports an intentionally empty carousel", () => {
    expect(aestheticCarouselItems(images, [], "images")).toEqual([]);
  });
});
