/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { buildDistributionPlanSvg } from "@/lib/distribution-export-plan";
import type { HouseModel } from "@/lib/house-distribution";

function model(): HouseModel {
  const source = { documentId: "private-plan", page: 7, sheet: "L-05" };
  return {
    schemaVersion: 1, revision: 6, name: "Casa de prueba", sourceDocumentIds: [source.documentId], notes: "No se suman áreas superpuestas.",
    rooms: [{ id: "room-1", name: "Sala", polygon: [[-1, 0], [3, 0], [3, 3], [1, 3], [1, 2], [-1, 2]], color: "#aabbcc", source, height: { value: null, status: "unconfirmed", source, note: "Altura pendiente de revisión" }, finishes: "", notes: "", coverage: { outlet: "reviewed", light: "partial", switch: "unconfirmed", ac: "unconfirmed" } }],
    walls: [{ id: "front", start: [-1, 0], end: [3, 0], thickness: .15, height: 3, source }],
    openings: [{ id: "door-1", wallId: "front", roomIds: ["room-1"], kind: "door", offset: .5, width: .8, height: 2.1, sill: 0, source, status: "documented" }, { id: "window-1", wallId: "front", roomIds: ["room-1"], kind: "window", offset: 2, width: 1, height: 1.2, sill: 1, source, status: "approximate" }],
    fixtures: [{ id: "light-1", roomId: "room-1", kind: "light", type: "Luz de techo", position: [1.123456789, 1.5], height: 2.4, heightMeasurement: { value: null, status: "unconfirmed", source, note: "Pendiente" }, mount: "ceiling", circuit: "L1", specifications: "", status: "documented", source }],
    surfaces: [{ id: "plot", kind: "property", polygon: [[-400, -400], [400, -400], [400, 400], [-400, 400]], source, notes: "", measurements: [] }],
  };
}
const parseSvg = (value: string) => {
  const document = new DOMParser().parseFromString(value, "image/svg+xml");
  expect(document.querySelector("parsererror")).toBeNull();
  return document;
};

describe("interior design SVG plan", () => {
  it("produces standalone XML in original model coordinates and metric dimensions", () => {
    const current = model(), before = structuredClone(current);
    const svg = buildDistributionPlanSvg(current), document = parseSvg(svg);
    expect(document.documentElement.namespaceURI).toBe("http://www.w3.org/2000/svg");
    expect(document.querySelector('[data-coordinate-units="metres"]')).not.toBeNull();
    expect(document.querySelector('[data-room-id="room-1"] polygon')?.getAttribute("points")).toBe("-1,0 3,0 3,3 1,3 1,2 -1,2");
    expect(document.querySelector('[data-room-row="room-1"]')?.textContent).toContain("4.00");
    expect(document.querySelector('[data-room-row="room-1"]')?.textContent).toContain("3.00");
    expect(document.querySelector('[data-room-row="room-1"]')?.textContent).toContain("10.00");
    expect(document.querySelector('[data-room-row="room-1"]')?.textContent).toContain("Pendiente");
    expect(document.querySelector('[data-fixture-id="light-1"] circle')?.getAttribute("cx")).toBe("1.123456789");
    expect(document.querySelector('[data-fixture-id="light-1"] title')?.textContent).toContain("altura sin confirmar");
    expect(document.documentElement.textContent).toContain("sin norte geográfico");
    expect(document.documentElement.textContent).toContain("No equivalen a áreas netas");
    expect(document.documentElement.textContent).toContain("No se suman áreas superpuestas");
    expect(current).toEqual(before);
  });

  it("leaves real opening gaps in walls and distinguishes doors from windows", () => {
    const document = parseSvg(buildDistributionPlanSvg(model()));
    const segments = [...document.querySelectorAll('[data-wall-id="front"] line')].map(line => [line.getAttribute("x1"), line.getAttribute("x2")]);
    expect(segments).toEqual([["-1", "-0.5"], ["0.30000000000000004", "1"], ["2", "3"]]);
    const door = document.querySelector('[data-opening-id="door-1"]');
    expect(door?.getAttribute("data-opening-kind")).toBe("door");
    expect(door?.querySelectorAll("line")).toHaveLength(1);
    expect(door?.querySelector("line")?.getAttribute("stroke-dasharray")).toBe(".09 .05");
    const window = document.querySelector('[data-opening-id="window-1"]');
    expect(window?.getAttribute("data-opening-kind")).toBe("window");
    expect(window?.querySelectorAll("line")).toHaveLength(2);
    expect(window?.textContent).toContain("aproximada");
  });

  it("does not expand the building viewport to fit a large property", () => {
    const withProperty = model(), withoutProperty = model();
    delete withoutProperty.surfaces;
    const a = parseSvg(buildDistributionPlanSvg(withProperty)), b = parseSvg(buildDistributionPlanSvg(withoutProperty));
    expect(a.documentElement.getAttribute("viewBox")).toBe(b.documentElement.getAttribute("viewBox"));
    expect(a.querySelector("#model-plan")?.getAttribute("transform")).toBe(b.querySelector("#model-plan")?.getAttribute("transform"));
    expect(a.querySelector('[data-room-id="plot"]')).toBeNull();
  });

  it("keeps labels inside a narrow concave room and maps compact labels to the complete room table", () => {
    const current = model();
    current.rooms[0].polygon = [[0, 0], [5, 0], [5, .4], [.4, .4], [.4, 5], [0, 5]];
    const document = parseSvg(buildDistributionPlanSvg(current));
    const label = document.querySelector('[data-room-id="room-1"] text')!;
    const x = Number(label.getAttribute("x")), y = Number(label.getAttribute("y"));
    expect((x < .4 && y < 5) || (y < .4 && x < 5)).toBe(true);
    expect(label.textContent).toBe("1");
    expect(document.querySelector('[data-room-row="room-1"]')?.textContent).toContain("1. Sala");
    expect(document.querySelector('[data-room-row="room-1"]')?.textContent).toContain("3.84");
  });

  it("does not promote a legacy fixture display height to a captured measurement", () => {
    const current = model();
    delete current.fixtures[0].heightMeasurement;
    const document = parseSvg(buildDistributionPlanSvg(current));
    expect(document.querySelector('[data-fixture-id="light-1"] title')?.textContent).toContain("altura sin confirmar");
    expect(document.querySelector('[data-fixture-id="light-1"] title')?.textContent).not.toContain("altura 2.40");
    current.fixtures[0].heightMeasurement = { value: 2.65, status: "approximate", source: current.fixtures[0].source, note: "Verificar" };
    const measured = parseSvg(buildDistributionPlanSvg(current));
    expect(measured.querySelector('[data-fixture-id="light-1"] title')?.textContent).toContain("altura 2.65 m (aproximada)");
  });

  it("escapes untrusted text and attributes and rejects paints that could reference external resources", () => {
    const current = model();
    current.name = 'Casa <script>alert("x")</script> & interior';
    current.notes = '<image href="https://private.invalid" onload="alert(1)"/>\u0000';
    current.rooms[0].name = 'Sala </text><script>alert(2)</script>';
    current.rooms[0].id = 'room" onload="alert(3)';
    current.rooms[0].color = 'url(https://private.invalid)';
    current.fixtures[0].id = 'fixture" href="https://private.invalid';
    current.fixtures[0].specifications = '<foreignObject>test</foreignObject>';
    const document = parseSvg(buildDistributionPlanSvg(current));
    expect(document.querySelector("script,image,foreignObject,a")).toBeNull();
    for (const element of document.querySelectorAll("*")) {
      expect([...element.attributes].some(attribute => attribute.name.toLowerCase().startsWith("on") || /(?:^|:)href$/i.test(attribute.name))).toBe(false);
    }
    expect(document.querySelector("polygon")?.getAttribute("fill")).toBe("#dfe7ec");
    expect(document.querySelector("title")?.textContent).toContain(current.name);
    expect(document.querySelector("desc")?.textContent).toContain('<image href="https://private.invalid"');
    expect(document.querySelector('[data-fixture-row]')?.getAttribute("data-fixture-row")).toBe(current.fixtures[0].id);
  });
});
