import { FieldValue } from "firebase-admin/firestore";
import { decryptVaultBytes, encryptVaultBytes } from "./folder-vault-crypto";

export const vaultDocumentContext = (projectId: string, documentId: string, part: "content" | "metadata") =>
  `document:${projectId}:${documentId}:${part}`;

export function openVaultDocument(data: FirebaseFirestore.DocumentData, key: Buffer, projectId: string, id: string): FirebaseFirestore.DocumentData {
  if (data.encrypted !== true || typeof data.encryptedMetadata !== "string") throw new Error("Invalid encrypted document");
  const metadata = JSON.parse(decryptVaultBytes(Buffer.from(data.encryptedMetadata, "base64"), key,
    vaultDocumentContext(projectId, id, "metadata")).toString("utf8")) as Record<string, unknown>;
  return { ...data, ...metadata, encrypted: true };
}

export function sealVaultDocument(data: FirebaseFirestore.DocumentData, key: Buffer, projectId: string, id: string, rootId: string) {
  const metadata = {
    fileName: String(data.fileName || "Document"),
    contentType: String(data.contentType || "application/octet-stream"),
    size: Number(data.size || 0),
    uploadedBy: String(data.uploadedBy || ""),
    description: String(typeof data.description === "string" ? data.description : data.aiDescription || "").slice(0, 400),
  };
  return {
    encrypted: true,
    vaultFolderId: rootId,
    encryptedMetadata: encryptVaultBytes(Buffer.from(JSON.stringify(metadata)), key,
      vaultDocumentContext(projectId, id, "metadata")).toString("base64"),
    fileName: "Encrypted document",
    contentType: "application/octet-stream",
    uploadedBy: FieldValue.delete(),
    description: FieldValue.delete(),
    aiText: FieldValue.delete(),
    aiDescription: FieldValue.delete(),
    aiIndexProvider: FieldValue.delete(),
    aiIndexError: FieldValue.delete(),
    aiIndexStatus: "encrypted",
    thumbnailObjectKey: FieldValue.delete(),
    quoteReferenceEnabled: false,
  };
}
