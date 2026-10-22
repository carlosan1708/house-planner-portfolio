/** Missing parentId is a root folder, keeping existing projects compatible. */
export type AestheticNavigationFolder = {
  id: string;
  name: string;
  parentId?: string | null;
};

export function aestheticFolderTrail<T extends AestheticNavigationFolder>(folders: T[], folderId: string): T[] {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const trail: T[] = [];
  const visited = new Set<string>();
  let current = byId.get(folderId);
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    trail.unshift(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return trail;
}

export function aestheticFolderPath(folders: AestheticNavigationFolder[], folderId: string): string {
  return aestheticFolderTrail(folders, folderId).map((folder) => folder.name).join(" / ");
}

export function aestheticChildFolders<T extends AestheticNavigationFolder>(folders: T[], parentId: string | null): T[] {
  return folders.filter((folder) => (folder.parentId || null) === parentId);
}

/** Resolve by project-wide ID, not the folder currently being browsed. */
export function aestheticCarouselItems<T extends { id: string; mediaType: "image" | "pdf" }>(
  images: T[], imageIds: string[], kind: "images" | "plans",
): T[] {
  const mediaType = kind === "plans" ? "pdf" : "image";
  const byId = new Map(images.filter((image) => image.mediaType === mediaType).map((image) => [image.id, image]));
  return [...new Set(imageIds)].flatMap((id) => {
    const image = byId.get(id);
    return image ? [image] : [];
  });
}
