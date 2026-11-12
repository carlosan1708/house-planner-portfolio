import type { ReactNode } from "react";
import type { AssistantCitation } from "@/lib/assistant";

type Language = "en" | "es";

function localUrl(href: string) {
  if (!href.startsWith("/") || href.startsWith("//")) return null;
  const url = new URL(href, "https://house-planner.invalid");
  return url.origin === "https://house-planner.invalid" ? url : null;
}

function inline(text: string, citations: AssistantCitation[]): ReactNode[] {
  const tokens = /\*\*([^*\n]+)\*\*|\[([^\]\n]+)\]\(([^)\s]+)\)/g;
  const parts = [];
  let end = 0;
  for (const match of text.matchAll(tokens)) {
    const [token, bold, label, href] = match;
    const index = match.index;
    parts.push(text.slice(end, index));
    if (bold) {
      parts.push(<strong key={index}>{inline(bold, citations)}</strong>);
    } else {
      // Only links returned by the app's citation tools become clickable.
      const citation = citations.find((source) => source.href === href && localUrl(href));
      parts.push(citation
        ? <a key={index} href={citation.href} target="_blank" rel="noopener noreferrer">{label}</a>
        : label);
    }
    end = index + token.length;
  }
  parts.push(text.slice(end));
  return parts;
}

export function AssistantAnswer({ text, citations }: { text: string; citations: AssistantCitation[] }) {
  const blocks: { kind: "paragraph" | "bullet" | "number"; lines: string[] }[] = [];
  let current: (typeof blocks)[number] | undefined;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      current = undefined;
      continue;
    }
    const item = trimmed.match(/^([-*]|\d+[.)])\s+(.+)$/);
    const kind = item ? (/\d/.test(item[1]) ? "number" : "bullet") : "paragraph";
    if (!current || current.kind !== kind) {
      current = { kind, lines: [] };
      blocks.push(current);
    }
    current.lines.push(item?.[2] ?? trimmed);
  }
  return <div className="assistant-answer">{blocks.map(({ kind, lines }, index) => {
    if (kind === "paragraph") return <p key={index}>{inline(lines.join("\n"), citations)}</p>;
    const List = kind === "number" ? "ol" : "ul";
    return <List key={index}>{lines.map((line, lineIndex) => <li key={lineIndex}>{inline(line, citations)}</li>)}</List>;
  })}</div>;
}

export function AssistantSources({ citations, language, onOpenBudget }: {
  citations: AssistantCitation[];
  language: Language;
  onOpenBudget: () => void;
}) {
  const es = language === "es";
  const documents = new Map<string, { title: string; download?: string; pages: AssistantCitation[] }>();
  const others: AssistantCitation[] = [];
  for (const citation of citations) {
    const url = citation.href ? localUrl(citation.href) : null;
    if (citation.kind !== "document" || !url) {
      others.push(citation);
      continue;
    }
    const key = url.pathname + url.search;
    let document = documents.get(key);
    if (!document) {
      const download = url.pathname === "/api/files" && url.searchParams.has("id") ? new URLSearchParams(url.search) : null;
      download?.delete("preview");
      document = { title: citation.label.replace(/\s+·\s+p\.\s+\d+$/, ""), download: download ? url.pathname + "?" + download : undefined, pages: [] };
      documents.set(key, document);
    }
    if (!document.pages.some((page) => page.href === citation.href)) document.pages.push(citation);
  }
  if (!documents.size && !others.length) return null;
  return <section className="assistant-sources" aria-label={es ? "Fuentes" : "Sources"}>
    <div className="assistant-source-label">{es ? "Fuentes" : "Sources"}</div>
    {[...documents].map(([key, document]) => <div key={key} className="assistant-source-file">
      <b>{document.title}</b>
      <div className="assistant-source-actions">
        {document.download && <a className="assistant-source-download" href={document.download} aria-label={(es ? "Descargar " : "Download ") + document.title}>{es ? "Descargar" : "Download"}</a>}
        {document.pages.map((page) => {
          const number = page.href?.match(/#page=(\d+)$/)?.[1];
          return <a key={page.id} href={page.href} aria-label={page.label} target="_blank" rel="noopener noreferrer">
            {number ? (es ? "Pág. " : "Page ") + number : es ? "Abrir" : "Open"}
          </a>;
        })}
      </div>
    </div>)}
    {others.length > 0 && <div className="assistant-citations">
      {others.map((source) => source.href && localUrl(source.href)
        ? <a key={source.id} href={source.href} target="_blank" rel="noopener noreferrer">{source.label}</a>
        : source.kind === "budget"
          ? <button type="button" key={source.id} onClick={onOpenBudget}>{source.label}</button>
          : <span key={source.id}>{source.label}</span>)}
    </div>}
  </section>;
}
