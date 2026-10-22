import type { ProjectNote } from "./project-notes";

type Language = "en" | "es";
const tr = (language: Language, en: string, es: string) => language === "es" ? es : en;

// Public fictional notes, shared by the note editor and scripted assistant examples.
export function demoProjectNotes(language: Language): ProjectNote[] {
  return [
    { id: "demo-note-finishes", title: tr(language, "Kitchen finishes · confirmed palette", "Acabados de cocina · paleta confirmada"), content: tr(language, "Casa Mirador: fictional 120 m² house with two bedrooms and one bathroom. The kitchen cabinetry objective is USD 10,000; no supplier quote or payment is recorded.\n\nDecision: warm oak lower cabinets, off-white upper cabinets and a matte light-stone countertop. Keep the sample board on site for approval before ordering.\n\nNext step: resolve the USD 500 finish excess (USD 15,500 quoted / USD 15,000 objective) before paying a deposit. No finish payments have been recorded.", "Casa Mirador: casa ficticia de 120 m², dos dormitorios y un baño. El objetivo de mobiliario de cocina es USD 10.000; no hay cotizaciones de proveedor ni pagos registrados.\n\nDecisión: muebles bajos en roble cálido, muebles altos blanco hueso y sobre claro mate. Mantener el tablero de muestras en obra para aprobar antes de comprar.\n\nSiguiente paso: resolver el exceso de USD 500 en acabados (USD 15.500 cotizado / USD 15.000 objetivo) antes del anticipo. No hay pagos registrados para acabados."), aiEnabled: true },
    { id: "demo-note-delivery", title: tr(language, "Site access and delivery window", "Acceso a obra y horario de entregas"), content: tr(language, "Deliveries: Monday–Friday, 8:00–15:00. Confirm access with the site lead one day ahead. Reserve a dry storage area for finishes; keep the driveway clear for the roof delivery.\n\nFictional project information for the interactive demo.", "Entregas: lunes a viernes, 8:00–15:00. Confirmar el acceso con la jefatura de obra el día anterior. Reservar una zona seca para acabados; mantener libre la entrada para la entrega de cubierta.\n\nInformación ficticia del proyecto para la demo interactiva."), aiEnabled: true },
    { id: "demo-note-visit", title: tr(language, "Next site visit · owner checklist", "Próxima visita · lista del propietario"), content: tr(language, "Photograph the bathroom waterproofing before tiles are installed. Verify kitchen outlet heights against the cabinet drawing. Bring the approved flooring sample.\n\nThis note is excluded from AI context until you choose to enable it.", "Fotografiar la impermeabilización del baño antes de colocar el enchape. Verificar la altura de los tomacorrientes de cocina con el plano de mobiliario. Llevar la muestra de piso aprobada.\n\nEsta nota queda fuera del contexto de la IA hasta que decidas habilitarla."), aiEnabled: false },
  ].map((note, index) => ({ ...note, createdBy: "demo", updatedBy: "demo", createdAt: `2026-07-0${9 - index}T15:00:00.000Z`, updatedAt: `2026-07-0${9 - index}T15:00:00.000Z` }));
}


/** Translate only untouched sample copy; keep user-authored text and AI choices. */
export function localizeDemoNote(note: ProjectNote, language: Language): ProjectNote {
  const english = demoProjectNotes("en").find((item) => item.id === note.id);
  const spanish = demoProjectNotes("es").find((item) => item.id === note.id);
  const localized = language === "es" ? spanish : english;
  if (!english || !spanish || !localized) return note;
  return { ...note,
    title: [english.title, spanish.title].includes(note.title) ? localized.title : note.title,
    content: [english.content, spanish.content].includes(note.content) ? localized.content : note.content,
  };
}
