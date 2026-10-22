export type FolderLike = { id: string; parentId: string | null };
export type DocumentLike = { folderId: string | null; name: string; description?: string };

export function documentsInFolder<T extends DocumentLike>(documents: T[], folderId: string | "root", search = "") {
  const query = search.trim().toLowerCase();
  return documents.filter((document) => (folderId === "root" ? document.folderId === null : document.folderId === folderId) && (!query || `${document.name} ${document.description || ""}`.toLowerCase().includes(query)));
}

export function childFolders<T extends FolderLike>(folders: T[], folderId: string | "root") {
  const parentId = folderId === "root" ? null : folderId;
  return folders.filter((folder) => folder.parentId === parentId);
}
