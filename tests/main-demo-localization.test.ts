import { describe, expect, it } from "vitest";
import { demoFieldKey, localizeMainDemo, localizeMainDemoRecord, projectDemoSeed, workspaceEnumLabel } from "../lib/main-demo-localization";

describe("owned main demo seed localization", () => {
  it("switches seed descriptions both directions while preserving numbers, IDs, dates and edits", () => {
    const record = { id: "demo-plan-foundation", title: "Foundation and slab", phase: "Structure", owner: "My chosen team", notes: "My exact note", startDate: "2026-09-07", dependsOn: ["stable-id"], amount: 42 };
    const es = localizeMainDemoRecord("plan", record, "es");
    expect(es.title).toBe("Cimentación y losa");
    expect(es.phase).toBe("Estructura");
    expect(es).toMatchObject({ owner: "My chosen team", notes: "My exact note", amount: 42, startDate: record.startDate, dependsOn: record.dependsOn });
    expect(record.title).toBe("Foundation and slab");
    expect(localizeMainDemoRecord("plan", es, "en")).toEqual(record);
    expect(localizeMainDemoRecord("plan", { ...es, title: "My custom title" }, "en").title).toBe("My custom title");
  });
  it("leaves unknown/user-created records untouched and does not recreate removed rows", () => {
    const custom = { id: "private-or-new", title: "Foundation and slab", status: "open" };
    expect(localizeMainDemoRecord("plan", custom, "es")).toBe(custom);
    expect(localizeMainDemo("plan", [], "es")).toEqual([]);
    expect(projectDemoSeed(custom,"es")).toBe(custom);
  });
  it("localizes nested approval labels without rewriting grouping, cell values or source formulas", () => {
    const seed = { id: "demo-approval", title: "20% labor adjustment and scope review", change_details: [{ sheet: "Presupuesto", rowLabel: "Roof structure and covering labor", groupLabel: "Mano de obra general", before: { value: 10, formula: "Presupuesto!E94" }, after: { value: 20 } }] };
    const en = localizeMainDemoRecord("approvals", seed, "en");
    expect(en.change_details[0]).toMatchObject({ sheet: "Presupuesto", groupLabel: "Mano de obra general", before: seed.change_details[0].before, after: seed.change_details[0].after });
    expect(localizeMainDemoRecord("approvals", seed, "es").change_details[0].rowLabel).toBe("Mano de obra de estructura y cubierta de techo");
    expect(seed.change_details[0].sheet).toBe("Presupuesto");
  });
  it("preserves countdown dates and chooses the matching fictional document alias", () => {
    const countdown = { id: "demo-countdown", title: "Confirmar acabados de cocina", startedAt: "start", dueAt: "due", acknowledged: true };
    expect(localizeMainDemoRecord("countdowns", countdown, "en")).toEqual({ ...countdown, title: "Confirm kitchen finishes" });
    const document = { id: "demo-quote", name: "Cotizacion_demo.txt", downloadUrl: "/demo/Cotizacion_demo.txt" };
    expect(localizeMainDemoRecord("documents", document, "en")).toEqual({ id: document.id, name: "Demo_Quote.txt", downloadUrl: "/demo/Demo_Quote.txt" });
    expect(localizeMainDemoRecord("documents", { ...document, name: "My custom filename.txt" }, "en").name).toBe("My custom filename.txt");
  });
  it("labels canonical enums without changing their values", () => {
    expect(workspaceEnumLabel("in_progress", "es")).toBe("En progreso");
    expect(workspaceEnumLabel("critical", "es")).toBe("Crítica");
    expect(workspaceEnumLabel("inspection", "en")).toBe("Inspection");
    expect(workspaceEnumLabel("custom_value", "es")).toBe("custom value");
  });
});

describe("demo text ownership and stable filters", () => {
  it("preserves deliberate edits even when they equal another language's seed", () => {
    const item = { id: "demo-plan-foundation", title: "Cimentación y losa", phase: "Estructura", owner: "Contractor" };
    expect(localizeMainDemoRecord("plan", item, "en", ["title", "phase"])).toEqual({ ...item, owner: "Contractor" });
    expect(demoFieldKey("plan", item, "phase", ["phase"])).toBe("Estructura");
  });
  it("keeps the phase filter key across EN/ES without reclassifying custom phases", () => {
    const en = { id: "demo-plan-foundation", phase: "Structure" };
    const es = localizeMainDemoRecord("plan", en, "es");
    expect(demoFieldKey("plan", en, "phase")).toBe(demoFieldKey("plan", es, "phase"));
    expect(demoFieldKey("plan", { id: "user-record", phase: "Estructura" }, "phase")).toBe("Estructura");
  });
  it("projects registered template fields and dependencies while preserving dates and custom edits", () => {
    const owned = { title: { en: "Site preparation", es: "Preparación del terreno" }, "dependsOn.0": { en: "Foundation", es: "Cimentación" } };
    const item = { id: "generated-demo-template", title: "Site preparation", dependsOn: ["Foundation"], startDate: "2026-10-20", amount: 100 };
    const es = localizeMainDemoRecord("plan", item, "es", [], owned);
    expect(es).toEqual({ ...item, title: "Preparación del terreno", dependsOn: ["Cimentación"] });
    expect(localizeMainDemoRecord("plan", es, "en", ["dependsOn"], owned)).toEqual({ ...item, dependsOn: ["Cimentación"] });
    expect(item.dependsOn).toEqual(["Foundation"]);
  });
});
