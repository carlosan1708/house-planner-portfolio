type Language = "en" | "es";
type TextPair = { en: string; es: string };
type OwnedTemplate = {
  id: string; name: string; description: string;
  items: Array<{ title: string; phase: string; owner: string; notes: string; dependsOn: string[] }>;
};

// Only the bundled template definitions use this catalog. Saved plan items remain user content.
const OWNED_TEMPLATE_IDS = new Set(["costa-rica-construction", "basic-home-build", "renovation"]);
const TEXT_PAIRS: Array<[string, string]> = [
  ["Costa Rica construction plan", "Plan de construcción Costa Rica"],
  ["A phased template with municipal permits, responsible professionals, and construction regulation checkpoints.", "Plantilla por fases con permisos municipales, profesionales responsables y puntos de control del reglamento de construcción."],
  ["Property due diligence and review", "Debida diligencia y revisión de la propiedad"],
  ["Design and responsible professionals", "Diseño y profesionales responsables"],
  ["Municipal construction permit", "Permiso de construcción municipal"],
  ["Advance notices and insurance", "Avisos previos y seguros"],
  ["Foundation and structure", "Cimentación y estructura"],
  ["Enclosure, MEP, and finishes", "Cerramiento, MEP y acabados"],
  ["Final inspections and occupancy", "Inspecciones finales y ocupación"],
  ["Pre-construction", "Pre-construcción"],
  ["Permits", "Permisos"],
  ["Owner / Lawyer", "Propietario / Abogado"],
  ["Architect / Engineer", "Arquitecto / Ingeniero"],
  ["Responsible professional", "Profesional responsable"],
  ["Contractor / Engineer", "Contratista / Ingeniero"],
  ["Confirm municipal zoning, water availability letter, cadastral plan, and land-use restrictions.", "Confirmar zonificación municipal, carta de disponibilidad de agua, plano catastrado y restricciones de uso."],
  ["Hire CFIA-registered professionals and define the professional responsible for the project.", "Contratar profesionales inscritos en el CFIA y definir al profesional responsable del proyecto."],
  ["Submit plans, forms, required studies, and municipal fees under local construction regulations.", "Presentar planos, formularios, estudios requeridos y tasas municipales conforme al reglamento de construcción local."],
  ["Coordinate utility approvals, construction signage, insurance, and occupational safety measures.", "Coordinar aprobaciones de servicios, rótulo de construcción, pólizas y medidas de seguridad ocupacional."],
  ["Complete foundations, structure, and required inspections before proceeding.", "Ejecutar cimentación, estructura y las inspecciones requeridas antes de continuar."],
  ["Complete the enclosure, mechanical, electrical, sanitary systems, and interior finishes.", "Completar cerramiento, sistemas mecánicos, eléctricos, sanitarios y acabados interiores."],
  ["Complete final inspections, municipal approvals, warranties, and handover documentation.", "Completar inspecciones finales, aprobaciones municipales, garantías y documentación de entrega."],
  ["Basic home build", "Construcción básica de vivienda"],
  ["A simple five-phase construction roadmap for a single-family home.", "Un plan sencillo de cinco fases para construir una vivienda unifamiliar."],
  ["Site preparation", "Preparación del terreno"],
  ["Foundation", "Cimentación"],
  ["Frame and enclosure", "Estructura y cerramiento"],
  ["Systems and finishes", "Sistemas y acabados"],
  ["Closeout", "Cierre"],
  ["Site", "Terreno"],
  ["Structure", "Estructura"],
  ["Interior", "Interior"],
  ["Construction", "Construcción"],
  ["Contractor", "Contratista"],
  ["Owner / Contractor", "Propietario / Contratista"],
  ["Clear, survey, and prepare the building footprint.", "Limpiar, medir y preparar la huella de la construcción."],
  ["Form, reinforce, pour, and cure the foundation.", "Encofrar, reforzar, colar y curar la cimentación."],
  ["Complete structure, roof, windows, and exterior doors.", "Completar la estructura, el techo, las ventanas y las puertas exteriores."],
  ["Install MEP systems, drywall, paint, and finishes.", "Instalar los sistemas MEP, las paredes de yeso, la pintura y los acabados."],
  ["Punch list, cleaning, handover, and warranty review.", "Lista de pendientes, limpieza, entrega y revisión de garantías."],
  ["Interior renovation", "Remodelación interior"],
  ["A focused renovation plan for kitchens, bathrooms, and finish upgrades.", "Un plan de remodelación para cocinas, baños y mejoras de acabados."],
  ["Survey and scope", "Levantamiento y alcance"],
  ["Demolition and prep", "Demolición y preparación"],
  ["Rough-in", "Instalaciones preliminares"],
  ["Finishes and fixtures", "Acabados y equipos"],
  ["Inspection and handover", "Inspección y entrega"],
  ["Planning", "Planificación"],
  ["Designer", "Diseñador"],
  ["Confirm existing conditions, scope, and finish decisions.", "Confirmar las condiciones existentes, el alcance y las decisiones de acabados."],
  ["Protect unaffected areas and remove selected finishes.", "Proteger las áreas que se conservan y retirar los acabados seleccionados."],
  ["Adjust electrical, plumbing, and framing as required.", "Ajustar las instalaciones eléctricas, sanitarias y la estructura según lo requerido."],
  ["Install tile, cabinetry, counters, paint, and fixtures.", "Instalar las baldosas, los muebles, las encimeras, la pintura y los equipos."],
  ["Final inspection, punch list, and handover.", "Inspección final, lista de pendientes y entrega."],
];
const PAIRS_BY_TEXT = new Map<string, TextPair>();
for (const [en, es] of TEXT_PAIRS) {
  const pair = { en, es };
  PAIRS_BY_TEXT.set(en, pair); PAIRS_BY_TEXT.set(es, pair);
}

/** Look up an owned template string; callers must first establish ownership of the record/field. */
export function planTemplateTextPair(value: string): TextPair | undefined {
  const pair = PAIRS_BY_TEXT.get(value);
  return pair ? { ...pair } : undefined;
}

/** Clone bundled definitions for the selected language, keeping dependency titles coherent. */
export function localizePlanTemplates<T extends OwnedTemplate>(templates: T[], language: Language): T[] {
  return templates.map(template => {
    const copy = { ...template, items: template.items.map(item => ({ ...item, dependsOn: [...item.dependsOn] })) } as T;
    if (!OWNED_TEMPLATE_IDS.has(template.id)) return copy;
    const text = (value: string) => planTemplateTextPair(value)?.[language] ?? value;
    const titles = new Map(template.items.map(item => [item.title, text(item.title)]));
    copy.name = text(template.name); copy.description = text(template.description);
    for (const item of copy.items) {
      item.title = text(item.title); item.phase = text(item.phase);
      item.owner = text(item.owner); item.notes = text(item.notes);
      item.dependsOn = item.dependsOn.map(title => titles.get(title) ?? text(title));
    }
    return copy;
  });
}
