import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { localizePlanTemplates, planTemplateTextPair } from "@/lib/plan-template-localization";

const basic = {
  id: "basic-home-build", name: "Basic home build", description: "A simple five-phase construction roadmap for a single-family home.",
  items: [
    { title: "Site preparation", phase: "Site", owner: "Contractor", notes: "Clear, survey, and prepare the building footprint.", dependsOn: [] as string[], startDate: "2026-10-01", endDate: null, status: "not_started", offsetDays: 0, durationDays: 10 },
    { title: "Foundation", phase: "Structure", owner: "Contractor", notes: "Form, reinforce, pour, and cure the foundation.", dependsOn: ["Site preparation"], startDate: null, endDate: null, status: "not_started", offsetDays: 10, durationDays: 25 },
  ],
};

describe("owned plan template localization", () => {
  it("covers every authored text field in the three actual bundled templates", () => {
    const source = readFileSync("app/HousePlanner.tsx", "utf8");
    const start = source.indexOf("const PLAN_TEMPLATES:");
    const end = source.indexOf("\nconst t =", start);
    expect(start).toBeGreaterThan(-1); expect(end).toBeGreaterThan(start);
    const templateSource = source.slice(start, end);
    const texts = [...templateSource.matchAll(/(?:name|description|title|phase|owner|notes): "([^"\n]+)"/g)].map(match => match[1]);
    expect(texts).toHaveLength(74); // Six template labels plus four fields on each of seventeen tasks.
    for (const text of texts) {
      const pair = planTemplateTextPair(text);
      expect(pair, `Untranslated bundled template field: ${text}`).toBeDefined();
      expect(pair?.en).toBeTruthy(); expect(pair?.es).toBeTruthy();
    }
    const dependencies = [...templateSource.matchAll(/dependsOn: \[([^\]]*)\]/g)]
      .flatMap(match => [...match[1].matchAll(/"([^"]+)"/g)].map(title => title[1]));
    for (const title of dependencies) expect(planTemplateTextPair(title)).toBeDefined();
  });

  it("translates both descriptions and item fields, preserves dates/numbers/status, and round-trips dependencies", () => {
    const before = JSON.stringify(basic);
    const spanish = localizePlanTemplates([basic], "es");
    expect(spanish[0].name).toBe("Construcción básica de vivienda");
    expect(spanish[0].description).toContain("vivienda unifamiliar");
    expect(spanish[0].items[0]).toMatchObject({ title: "Preparación del terreno", phase: "Terreno", owner: "Contratista", notes: "Limpiar, medir y preparar la huella de la construcción.", startDate: "2026-10-01", offsetDays: 0, durationDays: 10, status: "not_started" });
    expect(spanish[0].items[1].dependsOn).toEqual([spanish[0].items[0].title]);
    expect(localizePlanTemplates(spanish, "en")).toEqual([basic]);
    expect(JSON.stringify(basic)).toBe(before);
    expect(spanish[0]).not.toBe(basic);
    expect(spanish[0].items[1].dependsOn).not.toBe(basic.items[1].dependsOn);
  });

  it.each([
    ["costa-rica-construction", "Plan de construcción Costa Rica", "Debida diligencia y revisión de la propiedad", "Diseño y profesionales responsables"],
    ["renovation", "Interior renovation", "Survey and scope", "Demolition and prep"],
  ])("keeps %s dependencies in the same language as their task titles", (id, name, first, second) => {
    const template = { id, name, description: "", items: [
      { title: first, phase: "Pre-construcción", owner: "Arquitecto / Ingeniero", notes: "", dependsOn: [] as string[] },
      { title: second, phase: "Construction", owner: "Contractor", notes: "", dependsOn: [first] },
    ] };
    for (const language of ["en", "es"] as const) {
      const result = localizePlanTemplates([template], language)[0];
      expect(result.items[1].dependsOn).toEqual([result.items[0].title]);
      expect(planTemplateTextPair(result.items[0].title)?.[language]).toBe(result.items[0].title);
    }
  });

  it("leaves unknown custom templates and user-defined strings verbatim", () => {
    const custom = { ...basic, id: "my-private-template", name: "Plan propio", items: [{ ...basic.items[0], title: "Site preparation", notes: "Mis instrucciones privadas", dependsOn: ["Revisión personalizada"] }] };
    const output = localizePlanTemplates([custom], "es")[0];
    expect(output).toEqual(custom);
    expect(output).not.toBe(custom);
    expect(planTemplateTextPair("Mis instrucciones privadas")).toBeUndefined();
    const edited = { ...basic, name: "My edited name", items: [{ ...basic.items[0], notes: "User edit" }] };
    expect(localizePlanTemplates([edited], "es")[0]).toMatchObject({ name: "My edited name", items: [{ notes: "User edit" }] });
  });

  it("returns independent text pairs for demo ownership registration", () => {
    const pair = planTemplateTextPair("Foundation")!;
    pair.es = "Changed by caller";
    expect(planTemplateTextPair("Cimentación")).toEqual({ en: "Foundation", es: "Cimentación" });
  });
});
