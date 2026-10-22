import type { BudgetLine } from "./workbook";

// Public, invented project data. Never derive this fixture from a private workspace.
export const DEMO_BUDGET_LINES: BudgetLine[] = [
  { id: "demo-structure", row: 4, chapter: "Structure", item: "Concrete and reinforcement", type: "Construction", subcategory: "Foundation", objective: 30000, excess: 0, quote: 29000, paid: 6200, supplier: "Demo Builder", status: "Completada" },
  { id: "demo-finishes", row: 5, chapter: "Finishes", item: "Floors and wall finishes", type: "Construction", subcategory: "Interior", objective: 15000, excess: 500, quote: 15500, paid: 0, supplier: "Demo Finishes", status: "En progreso" },
  { id: "demo-kitchen", row: 6, chapter: "Interiors", item: "Kitchen cabinetry", type: "Furniture", subcategory: "Kitchen", objective: 10000, excess: 0, quote: 0, paid: 0, supplier: "", status: "Pendiente" },
];

export const DEMO_PROPERTY_PROFILE = {
  revisionLabelEn: "Illustrative sample · fictional dimensions",
  revisionLabelEs: "Ejemplo ilustrativo · medidas ficticias",
  measurements: [
    { id: "house", labelEn: "House footprint (12 × 10 m)", labelEs: "Huella de la casa (12 × 10 m)", value: "120 m²", emphasis: true },
    { id: "living", labelEn: "Living and dining", labelEs: "Sala y comedor", value: "30 m²", emphasis: false },
    { id: "kitchen", labelEn: "Kitchen", labelEs: "Cocina", value: "15 m²", emphasis: false },
    { id: "bedrooms", labelEn: "Two bedrooms", labelEs: "Dos dormitorios", value: "36 m²", emphasis: false },
    { id: "bath", labelEn: "Bathroom", labelEs: "Baño", value: "9 m²", emphasis: false },
    { id: "entry", labelEn: "Entry, hall and utility", labelEs: "Entrada, pasillo y servicio", value: "30 m²", emphasis: false },
  ],
};
