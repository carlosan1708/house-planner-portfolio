export type OfferAssignment = { supplier: string; fileIndexes: number[] };

// Every uploaded document belongs to exactly one offer. Legacy uploads remain one offer.
export function parseOfferAssignments(raw: unknown, fileCount: number): OfferAssignment[] {
  if (raw == null) return [{ supplier: "Oferta 1", fileIndexes: Array.from({ length: fileCount }, (_, index) => index) }];
  if (!Array.isArray(raw) || !raw.length || raw.length > 5) throw new Error("Selecciona entre 1 y 5 proveedores.");
  const used = new Set<number>();
  const names = new Set<string>();
  const offers = raw.map((value) => {
    if (!value || typeof value !== "object") throw new Error("Oferta inválida.");
    const supplier = typeof value.supplier === "string" ? value.supplier.trim() : "";
    if (!supplier || supplier.length > 120 || names.has(supplier.toLowerCase())) throw new Error("Cada proveedor necesita un nombre diferente (máximo 120 caracteres).");
    names.add(supplier.toLowerCase());
    if (!Array.isArray(value.fileIndexes) || !value.fileIndexes.length) throw new Error("Agrega documentos a cada proveedor.");
    for (const index of value.fileIndexes) {
      if (!Number.isInteger(index) || index < 0 || index >= fileCount || used.has(index)) throw new Error("Cada documento debe pertenecer a una sola oferta.");
      used.add(index);
    }
    return { supplier, fileIndexes: value.fileIndexes as number[] };
  });
  if (used.size !== fileCount) throw new Error("Asigna todos los documentos a un proveedor.");
  return offers;
}

export type OfferComparison = {
  suppliers: Array<{ supplier: string; total: string; scope: string; caveats: string }>;
  rows: Array<{ item: string; values: Array<{ supplier: string; detail: string; evidence: string }>; conclusion: string }>;
};
