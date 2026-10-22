import type { MemberRecord } from "./project";
import { PROJECT_NOTES } from "./project";
import { firestore } from "./firebase-admin";
import { normalizeAssistantText } from "./assistant";
import { loadProjectAuthorDisplay, type ProjectAuthorDisplay } from "./project-authors";

export type ProjectNote = {
  id: string;
  title: string;
  content: string;
  aiEnabled: boolean;
  createdBy: string;
  updatedBy: string;
  createdAt: string | null;
  updatedAt: string | null;
};

const date = (value: unknown) => value && typeof value === "object" && "toDate" in value
  ? (value as FirebaseFirestore.Timestamp).toDate().toISOString()
  : null;

export function serializeProjectNote(document: FirebaseFirestore.DocumentSnapshot, authors?: ProjectAuthorDisplay): ProjectNote {
  const original = document.data() || {};
  const data = authors ? authors.redact(original) : original;
  return {
    id: document.id,
    title: String(data.title || ""),
    content: String(data.content || ""),
    aiEnabled: data.aiEnabled === true,
    createdBy: String(data.createdBy || ""),
    updatedBy: String(data.updatedBy || ""),
    createdAt: date(data.createdAt),
    updatedAt: date(data.updatedAt),
  };
}

export async function listProjectNotes(projectId: string) {
  const [snapshot, authors] = await Promise.all([
    firestore.collection(PROJECT_NOTES).where("projectId", "==", projectId).get(),
    loadProjectAuthorDisplay(projectId),
  ]);
  return snapshot.docs.map((document) => serializeProjectNote(document, authors)).sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || "") || a.title.localeCompare(b.title));
}

export function rankAssistantNotes(notes: ProjectNote[], query: string, limit = 5) {
  const genericTerms = new Set(["what", "which", "are", "the", "our", "project", "notes", "note", "saved", "information", "stored", "que", "cual", "cuales", "hay", "las", "los", "del", "de", "en", "notas", "nota", "proyecto", "guardadas", "guardada", "informacion", "datos", "tenemos"]);
  const terms = [...new Set(normalizeAssistantText(query).split(" ").filter((term) => term.length > 2 && !genericTerms.has(term)))];
  const excerpt = (content: string) => {
    if (content.length <= 3000) return content;
    const matchingLine = content.split(/\n+/).find((line) => terms.some((term) => normalizeAssistantText(line).includes(term)));
    const index = matchingLine ? content.indexOf(matchingLine) : 0;
    const start = Math.max(0, Math.min(index - 400, content.length - 3000));
    return `${start ? "…" : ""}${content.slice(start, start + 3000)}${start + 3000 < content.length ? "…" : ""}`;
  };
  return notes.filter((note) => note.aiEnabled).map((note) => {
    const title = normalizeAssistantText(note.title);
    const content = normalizeAssistantText(note.content);
    const score = terms.reduce((sum, term) => sum + (title.includes(term) ? 4 : 0) + (content.includes(term) ? 1 : 0), 0);
    return { note, score };
  }).filter(({ score }) => !terms.length || score > 0)
    .sort((a, b) => b.score - a.score || (b.note.updatedAt || "").localeCompare(a.note.updatedAt || ""))
    .slice(0, limit)
    .map(({ note }) => ({ id: note.id, title: note.title, excerpt: excerpt(note.content), updatedAt: note.updatedAt }));
}

export async function searchAssistantNotes(actor: MemberRecord, query: string) {
  if (actor.role !== "admin" && !actor.permissions.notes) return [];
  return rankAssistantNotes(await listProjectNotes(actor.projectId), query);
}

export function noteCitationsRemainEnabled(citations: unknown, enabledNoteIds: ReadonlySet<string>) {
  if (!Array.isArray(citations)) return true;
  return citations.every((citation) => citation?.kind !== "note" || (typeof citation.id === "string" && enabledNoteIds.has(citation.id)));
}
