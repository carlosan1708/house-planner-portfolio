export type DemoLanguage = "en" | "es";
export type DemoTextPair = { en: string; es: string };
export type DemoFieldCatalog = Record<string, DemoTextPair>;
const catalog: Record<string, Record<string, DemoFieldCatalog>> = {
  "folders": {
    "demo-quotes": {
      "name": {
        "en": "Quotes",
        "es": "Cotizaciones"
      }
    },
    "demo-plans": {
      "name": {
        "en": "Plans",
        "es": "Planos"
      }
    },
    "demo-plans-structural": {
      "name": {
        "en": "Structural",
        "es": "Estructurales"
      }
    }
  },
  "documents": {
    "demo-quote": {
      "name": {
        "en": "Demo_Quote.txt",
        "es": "Cotizacion_demo.txt"
      },
      "uploadedBy": {
        "en": "Demo Team",
        "es": "Equipo demo"
      },
      "downloadUrl": {
        "en": "/demo/Demo_Quote.txt",
        "es": "/demo/Cotizacion_demo.txt"
      }
    }
  },
  "expenses": {
    "demo-structure": {
      "vendor": {
        "en": "Demo Builder",
        "es": "Constructora Demo"
      },
      "description": {
        "en": "Concrete and reinforcement",
        "es": "Concreto y refuerzo"
      },
      "chapter": {
        "en": "Structure",
        "es": "Estructura"
      },
      "type": {
        "en": "Construction",
        "es": "Construcción"
      },
      "subcategory": {
        "en": "Foundation",
        "es": "Cimentación"
      },
      "attachments.0.fileName": {
        "en": "Demo_Invoice.txt",
        "es": "Factura_demo.txt"
      }
    },
    "demo-finishes": {
      "vendor": {
        "en": "Demo Finishes",
        "es": "Acabados Demo"
      },
      "description": {
        "en": "Floors and wall finishes",
        "es": "Pisos y acabados de paredes"
      },
      "chapter": {
        "en": "Finishes",
        "es": "Acabados"
      },
      "type": {
        "en": "Construction",
        "es": "Construcción"
      },
      "subcategory": {
        "en": "Interior",
        "es": "Interior"
      }
    }
  },
  "approvals": {
    "demo-approval": {
      "title": {
        "en": "20% labor adjustment and scope review",
        "es": "Ajuste de mano de obra del 20% y revisión del alcance"
      },
      "change_details.0.rowLabel": {
        "en": "Roof structure and covering labor",
        "es": "Mano de obra de estructura y cubierta de techo"
      },
      "change_details.1.rowLabel": {
        "en": "Roof structure and covering labor",
        "es": "Mano de obra de estructura y cubierta de techo"
      },
      "change_details.2.rowLabel": {
        "en": "Plumbing and sanitary labor",
        "es": "Mano de obra de fontanería y sanitarios"
      },
      "change_details.3.rowLabel": {
        "en": "Plumbing and sanitary labor",
        "es": "Mano de obra de fontanería y sanitarios"
      },
      "change_details.4.rowLabel": {
        "en": "Primary bathroom tub",
        "es": "Bañera del baño principal"
      },
      "change_details.5.rowLabel": {
        "en": "Target budget",
        "es": "Presupuesto objetivo"
      }
    }
  },
  "plan": {
    "demo-plan-foundation": {
      "title": {
        "en": "Foundation and slab",
        "es": "Cimentación y losa"
      },
      "phase": {
        "en": "Structure",
        "es": "Estructura"
      },
      "owner": {
        "en": "Demo Team",
        "es": "Equipo demo"
      },
      "notes": {
        "en": "Coordinate waterproofing before pouring.",
        "es": "Coordinar la impermeabilización antes del colado."
      }
    },
    "demo-plan-finishes": {
      "title": {
        "en": "Interior finishes",
        "es": "Acabados interiores"
      },
      "phase": {
        "en": "Finishes",
        "es": "Acabados"
      },
      "owner": {
        "en": "Design Studio",
        "es": "Estudio de diseño"
      },
      "notes": {
        "en": "Confirm stone and paint samples in Decisions.",
        "es": "Confirmar muestras de piedra y pintura en Decisiones."
      }
    }
  },
  "countdowns": {
    "demo-countdown": {
      "title": {
        "en": "Confirm kitchen finishes",
        "es": "Confirmar acabados de cocina"
      }
    }
  },
  "decisions": {
    "demo-decision-kitchen": {
      "area": {
        "en": "Kitchen",
        "es": "Cocina"
      },
      "title": {
        "en": "Countertop material",
        "es": "Material de la encimera"
      },
      "options": {
        "en": "Quartz / Granite / Porcelain",
        "es": "Cuarzo / Granito / Porcelanato"
      },
      "owner": {
        "en": "Owner",
        "es": "Propietario"
      }
    },
    "demo-decision-roof": {
      "area": {
        "en": "Structure",
        "es": "Estructura"
      },
      "title": {
        "en": "Roof finish",
        "es": "Acabado del techo"
      },
      "options": {
        "en": "Standing seam / Tile",
        "es": "Junta alzada / Teja"
      },
      "selected": {
        "en": "Standing seam",
        "es": "Junta alzada"
      },
      "owner": {
        "en": "Architect",
        "es": "Arquitecto"
      }
    }
  },
  "site": {
    "demo-issue-leak": {
      "title": {
        "en": "Water pooling near temporary entrance",
        "es": "Acumulación de agua junto a la entrada temporal"
      },
      "assignee": {
        "en": "Site Supervisor",
        "es": "Supervisor de obra"
      },
      "notes": {
        "en": "Add temporary drainage before next heavy rain.",
        "es": "Agregar drenaje temporal antes de la próxima lluvia fuerte."
      }
    },
    "demo-issue-inspection": {
      "title": {
        "en": "Foundation pre-pour inspection",
        "es": "Inspección de la cimentación antes del colado"
      },
      "assignee": {
        "en": "Structural Engineer",
        "es": "Ingeniero estructural"
      },
      "notes": {
        "en": "Verify rebar spacing and formwork alignment.",
        "es": "Verificar la separación del refuerzo y la alineación del encofrado."
      }
    }
  }
};

function readPath(value: unknown, parts: string[]): unknown {
  let current = value;
  for (const part of parts) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function withPath(value: unknown, parts: string[], text: string): unknown {
  const [key, ...rest] = parts;
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    const copy = [...value], index = Number(key);
    copy[index] = rest.length ? withPath(copy[index], rest, text) : text;
    return copy;
  }
  const record = value as Record<string, unknown>;
  return { ...record, [key]: rest.length ? withPath(record[key], rest, text) : text };
}

/** Project only known, unchanged seed fields. Unknown/user-entered fields remain verbatim. */
export function projectDemoSeed<T extends object>(record: T, language: DemoLanguage, fields?: DemoFieldCatalog, editedFields: readonly string[] = []): T {
  let localized: T = record;
  for (const [path, variants] of Object.entries(fields || {})) {
    if (editedFields.some(field => path === field || path.startsWith(`${field}.`))) continue;
    const parts = path.split("."), current = readPath(record, parts);
    if ((current === variants.en || current === variants.es) && current !== variants[language]) {
      localized = withPath(localized, parts, variants[language]) as T;
    }
  }
  return localized;
}

export function localizeMainDemoRecord<T extends object>(kind: string, record: T, language: DemoLanguage, editedFields: readonly string[] = [], ownedFields?: DemoFieldCatalog): T {
  const id = (record as Record<string, unknown>).id;
  return projectDemoSeed(record, language, ownedFields || (typeof id === "string" ? catalog[kind]?.[id] : undefined), editedFields);
}

export function localizeMainDemo<T extends object>(kind: string, records: T[], language: DemoLanguage): T[] {
  return records.map(record => localizeMainDemoRecord(kind, record, language));
}

const enumLabels: Record<string, DemoTextPair> = {
  open: { en: "Open", es: "Abierta" }, decided: { en: "Decided", es: "Decidida" },
  deferred: { en: "Deferred", es: "Diferida" }, resolved: { en: "Resolved", es: "Resuelta" },
  pending: { en: "Pending", es: "Pendiente" }, not_started: { en: "Not started", es: "No iniciado" },
  in_progress: { en: "In progress", es: "En progreso" }, done: { en: "Completed", es: "Completado" },
  completed: { en: "Completed", es: "Completado" }, blocked: { en: "Blocked", es: "Bloqueado" },
  low: { en: "Low", es: "Baja" }, medium: { en: "Medium", es: "Media" },
  high: { en: "High", es: "Alta" }, critical: { en: "Critical", es: "Crítica" },
  observation: { en: "Observation", es: "Observación" }, punch: { en: "Punch item", es: "Pendiente de obra" },
  permit: { en: "Permit", es: "Permiso" },
  inspection: { en: "Inspection", es: "Inspección" }, milestone: { en: "Milestone", es: "Hito" },
};
/** UI labels only; canonical status/category/priority values are never rewritten. */
export function workspaceEnumLabel(value: string, language: DemoLanguage): string {
  return enumLabels[value]?.[language] || value.replaceAll("_", " ");
}

/** Stable filter key for an owned pristine label; custom fields keep their literal value. */
export function demoFieldKey<T extends object>(kind: string, record: T, field: string, editedFields: readonly string[] = [], ownedFields?: DemoFieldCatalog): string {
  const id = (record as Record<string, unknown>).id;
  const pair = (ownedFields || (typeof id === "string" ? catalog[kind]?.[id] : undefined))?.[field];
  const value = readPath(record, field.split("."));
  return !editedFields.includes(field) && pair && (value === pair.en || value === pair.es) ? pair.en : String(value || "");
}
