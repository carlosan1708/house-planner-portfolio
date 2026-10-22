import { describe, expect, it } from "vitest";
import { detectAssistantLanguage, searchBudgetLines, validateProposalChanges } from "@/lib/assistant";
import { buildDocumentDescription } from "@/lib/document-index";
import type { BudgetLine } from "@/lib/workbook";

const lines: BudgetLine[] = [
  { id: "doors", row: 4, chapter: "Carpintería", item: "Puertas interiores", type: "Material", subcategory: "Madera", objective: 1000, excess: 0, quote: 950, paid: 0, supplier: "Maderas CR", status: "Cotizado" },
  { id: "windows", row: 5, chapter: "Cerramientos", item: "Ventanas de aluminio", type: "Material", subcategory: "Ventanas", objective: 2200, excess: 0, quote: 0, paid: 0, supplier: "", status: "Pendiente" },
];

describe("assistant budget safeguards", () => {
  it("matches bilingual and accent-insensitive budget descriptions", () => {
    expect(searchBudgetLines(lines, "change the interior doors")[0]?.id).toBe("doors");
    expect(searchBudgetLines(lines, "carpinteria madera")[0]?.id).toBe("doors");
  });

  it("uses an exact amount as a ranking signal", () => {
    expect(searchBudgetLines(lines, "material", { amount: 2200 })[0]?.id).toBe("windows");
  });

  it("detects the response language", () => {
    expect(detectAssistantLanguage("Necesito cambiar el presupuesto de las puertas", "en")).toBe("es");
    expect(detectAssistantLanguage("Find the matching budget entry", "es")).toBe("en");
  });

  it("accepts known editable cells and rejects formulas or negative money", () => {
    expect(validateProposalChanges(lines, [{ lineId: "doors", field: "objective", value: 1300, reason: "New target" }])[0]).toMatchObject({ before: 1000, after: 1300, row: 4 });
    expect(() => validateProposalChanges(lines, [{ lineId: "doors", field: "maximum", value: 1300 }])).toThrow("invalid_change_target");
    expect(() => validateProposalChanges(lines, [{ lineId: "doors", field: "status", value: "Done" }])).toThrow("invalid_change_target");
    expect(() => validateProposalChanges(lines, [{ lineId: "doors", field: "paid", value: -1 }])).toThrow("invalid_change_value");
  });
});

describe("assistant document references", () => {
  it("builds a concise saved description from the first meaningful PDF lines", () => {
    expect(buildDocumentDescription("contrato-obra.pdf", "CONTRATO DE OBRA\nCondiciones de pago y garantía\nMonto máximo CRC 6,000,000\nTexto adicional")).toBe("CONTRATO DE OBRA · Condiciones de pago y garantía · Monto máximo CRC 6,000,000");
  });

  it("falls back to a readable filename when a scanned PDF has no text", () => {
    expect(buildDocumentDescription("permiso_municipal.pdf", "")).toBe("Document: permiso municipal");
  });
});
