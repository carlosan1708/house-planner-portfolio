export type MovableFolder = {
  id: string;
  name: string;
  parentId: string | null;
};

export type FolderMoveValidation =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "folder_not_found"
        | "destination_not_found"
        | "top_level_forbidden"
        | "same_parent"
        | "self"
        | "descendant"
        | "duplicate";
    };

export function folderDescendantIds(
  folders: Pick<MovableFolder, "id" | "parentId">[],
  folderId: string,
) {
  const byParent = new Map<string | null, string[]>();
  for (const folder of folders) {
    const children = byParent.get(folder.parentId) ?? [];
    children.push(folder.id);
    byParent.set(folder.parentId, children);
  }

  const ids = new Set<string>();
  const visit = (id: string) => {
    if (ids.has(id)) return;
    ids.add(id);
    for (const childId of byParent.get(id) ?? []) visit(childId);
  };
  visit(folderId);
  return ids;
}

export function validateFolderMove(
  folders: MovableFolder[],
  folderId: string,
  parentId: string | null,
  options: { allowTopLevelSource?: boolean } = {},
): FolderMoveValidation {
  const source = folders.find((folder) => folder.id === folderId);
  if (!source) return { ok: false, reason: "folder_not_found" };
  if (source.parentId === parentId) return { ok: false, reason: "same_parent" };
  if (source.parentId === null && !options.allowTopLevelSource) {
    return { ok: false, reason: "top_level_forbidden" };
  }
  if (parentId === folderId) return { ok: false, reason: "self" };
  if (parentId && !folders.some((folder) => folder.id === parentId)) {
    return { ok: false, reason: "destination_not_found" };
  }
  if (parentId && folderDescendantIds(folders, folderId).has(parentId)) {
    return { ok: false, reason: "descendant" };
  }
  if (
    folders.some(
      (folder) =>
        folder.id !== folderId &&
        folder.parentId === parentId &&
        folder.name.toLocaleLowerCase() === source.name.toLocaleLowerCase(),
    )
  ) {
    return { ok: false, reason: "duplicate" };
  }
  return { ok: true };
}
