import { readFileSync, readdirSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { describe, expect, it } from "vitest";

function filesIn(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesIn(path) : [path];
  });
}

describe("public asset privacy", () => {
  const publicRoot = join(process.cwd(), "public");
  const files = filesIn(publicRoot).map((path) => relative(publicRoot, path).replaceAll("\\", "/"));

  it("never exposes project documents or workbooks outside the synthetic demo folder", () => {
    const privateDocumentExtensions = new Set([".xlsx", ".xls", ".pdf", ".doc", ".docx", ".csv"]);
    const exposed = files.filter((path) => !path.startsWith("demo/") && privateDocumentExtensions.has(extname(path).toLowerCase()));
    expect(exposed).toEqual([]);
  });

  it("keeps the demo download set explicitly synthetic", () => {
    const demoFiles = files.filter((path) => path.startsWith("demo/")).sort();
    expect(demoFiles).toEqual([
      "demo/Casa_Mirador_Project_Brief.txt",
      "demo/Cotizacion_demo.txt",
      "demo/Demo_Invoice.txt",
      "demo/Demo_Quote.txt",
      "demo/Factura_demo.txt",
      "demo/House_Planner_Demo.xlsx",
      "demo/House_Planner_Demo_en.xlsx",
      "demo/House_Planner_Demo_es.xlsx",
      "demo/Mirador_Finishes_en.txt",
      "demo/Mirador_Finishes_es.txt",
      "demo/Mirador_Roof_en.txt",
      "demo/Mirador_Roof_es.txt",
      "demo/casa-mirador-bath.svg",
      "demo/casa-mirador-exterior.webp",
      "demo/casa-mirador-kitchen.svg",
      "demo/casa-mirador-living.svg",
      "demo/casa-mirador-plan.svg",
    ]);
  });

  it("labels the invented Mirador illustrations and reviews and embeds no remote images", () => {
    for (const name of ["bath", "kitchen", "living", "plan"]) {
      const illustration = readFileSync(join(publicRoot, "demo", `casa-mirador-${name}.svg`), "utf8");
      expect(illustration).toMatch(/fictional|fictici/i);
      expect(illustration).not.toMatch(/(?:href|src)=["']https?:/i);
    }
    const brief = readFileSync(join(publicRoot, "demo", "Casa_Mirador_Project_Brief.txt"), "utf8");
    expect(brief).toContain("FICTIONAL PROJECT");
    expect(brief).toContain("USD 55,000");
    for (const kind of ["Finishes", "Roof"]) {
      const english = readFileSync(join(publicRoot, "demo", `Mirador_${kind}_en.txt`), "utf8");
      const spanish = readFileSync(join(publicRoot, "demo", `Mirador_${kind}_es.txt`), "utf8");
      expect(english).toContain("FICTIONAL OFFER");
      expect(spanish).toContain("OFERTA FICTICIA");
      expect(english).toContain(kind === "Finishes" ? "USD 15,500" : "USD 7,665");
      expect(spanish).toContain(kind === "Finishes" ? "USD 15.500" : "USD 7.665");
    }
  });

  it("keeps translated text downloads fictional with the same sample IDs and amounts", () => {
    for (const document of [
      { english: "Demo_Quote.txt", spanish: "Cotizacion_demo.txt", id: "COT-DEMO-019", enAmount: "USD 7,665", esAmount: "USD 7.665", status: "Pending" },
      { english: "Demo_Invoice.txt", spanish: "Factura_demo.txt", id: "FAC-DEMO-001", enAmount: "USD 840", esAmount: "USD 840", status: "Paid" },
    ]) {
      const english = readFileSync(join(publicRoot, "demo", document.english), "utf8");
      const spanish = readFileSync(join(publicRoot, "demo", document.spanish), "utf8");
      expect(english).toContain("FICTIONAL DEMONSTRATION DOCUMENT");
      expect(english).toContain("only fictional data");
      expect(english).toContain(document.id);
      expect(english).toContain(document.enAmount);
      expect(english).toContain(`Status: ${document.status}`);
      expect(english).not.toMatch(/Cotización:|Factura:|Proveedor:|Concepto:|Estado:|DOCUMENTO FICTICIO/);
      expect(spanish).toContain("DOCUMENTO FICTICIO DE DEMOSTRACIÓN");
      expect(spanish).toContain(document.id);
      expect(spanish).toContain(document.esAmount);
    }
  });
});
