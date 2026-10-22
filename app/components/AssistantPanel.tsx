"use client";

import { FormEvent, KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import type { AssistantCitation, AssistantMessage, AssistantProposal } from "@/lib/assistant";
import useModalFocus from "./useModalFocus";
import { DEMO_BUDGET_LINES, DEMO_PROPERTY_PROFILE } from "@/lib/demo-project";
import { demoProjectNotes } from "@/lib/demo-notes";

type Language = "en" | "es";
type Conversation = { id: string; title: string; lastMessage: string; updatedAt: string };
type Props = {
  mode?: "demo" | "real";
  language: Language;
  role: "admin" | "editor" | "viewer";
  canBudget: boolean;
  canDocuments: boolean;
  canNotes: boolean;
  onOpenBudget: (draftId?: string) => void;
};

const tr = (language: Language, en: string, es: string) => language === "es" ? es : en;

function proposalFrom(value: unknown): AssistantProposal | null {
  return value && typeof value === "object" && "id" in value ? value as AssistantProposal : null;
}

function preparedDemoAnswer(text: string, language: Language, canBudget: boolean, canNotes: boolean): { text: string; citations: AssistantCitation[] } {
  const normalized = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const budgetSource: AssistantCitation = { id: "demo-budget", kind: "budget", label: tr(language, "Fictional demo budget", "Presupuesto ficticio de ejemplo") };
  const planSource: AssistantCitation = { id: "demo-plan", kind: "document", label: tr(language, "Illustrative house plan · fictional dimensions", "Plano ilustrativo · medidas ficticias"), href: "/demo/casa-mirador-plan.svg" };
  const currency = (amount: number) => new Intl.NumberFormat(language === "es" ? "es-CR" : "en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(amount);
  const measurements = DEMO_PROPERTY_PROFILE.measurements;
  const kitchen = DEMO_BUDGET_LINES.find((line) => line.id === "demo-kitchen")!;
  const finish = DEMO_BUDGET_LINES.find((line) => line.id === "demo-finishes")!;
  const unsupported = { text: tr(language, "This demo has prepared examples for the budget, house dimensions, kitchen and saved notes. It does not generate other answers, change the budget or search the web. Choose an example or ask about one of these topics.", "Esta demo tiene ejemplos preparados de presupuesto, medidas de la casa, cocina y notas guardadas. No genera otras respuestas, cambia el presupuesto ni busca en internet. Elige un ejemplo o pregunta por uno de estos temas."), citations: [] };
  if (/\b(change|edit|update|increase|decrease|remove|delete|search|web|online|current|today|cambia|cambiar|modifica|editar|actualiza|aumenta|reduce|elimina|borra|busca|internet|actual|hoy)\b/.test(normalized)) return unsupported;
  if (/\b(kitchen|cocina)\b/.test(normalized)) return {
    text: tr(language, `Prepared kitchen example: the fictional kitchen is ${measurements.find((item) => item.id === "kitchen")!.value}.`, `Ejemplo preparado de cocina: la cocina ficticia mide ${measurements.find((item) => item.id === "kitchen")!.value}.`) + (canBudget ? tr(language, ` The kitchen cabinetry objective is ${currency(kitchen.objective)}. No supplier quote or payment has been recorded.`, ` El objetivo de mobiliario de cocina es ${currency(kitchen.objective)}. No hay cotizaciones de proveedor ni pagos registrados.`) : "") + tr(language, " These are invented values, not measurements taken from your project.", " Son valores inventados, no medidas tomadas de tu proyecto."),
    citations: [planSource, ...(canBudget ? [budgetSource] : [])],
  };
  if (/\b(note|notes|nota|notas)\b/.test(normalized)) {
    if (!canNotes) return unsupported;
    const enabled = demoProjectNotes(language).filter((note) => note.aiEnabled);
    return { text: tr(language, "Prepared notes example: ", "Ejemplo preparado de notas: ") + enabled.map((note) => `${note.title}: ${note.content}`).join("\n\n") + tr(language, "\n\nThis answer uses the original fictional examples; edits and AI toggles in Notes are not connected to these scripted replies.", "\n\nEsta respuesta usa los ejemplos ficticios originales; las ediciones y los controles de IA de Notas no están conectados a estas respuestas preparadas."), citations: enabled.map((note) => ({ id: note.id, kind: "note", label: note.title })) };
  }
  if (/\b(budget|presupuesto|spent|paid|payments|excess|pagado|pagos|exceso|gasto|gastos)\b/.test(normalized)) {
    if (!canBudget) return unsupported;
    const objective = DEMO_BUDGET_LINES.reduce((sum, line) => sum + line.objective, 0);
    const paid = DEMO_BUDGET_LINES.reduce((sum, line) => sum + line.paid, 0);
    return { text: tr(language, `Prepared budget example: Casa Mirador has a ${currency(objective)} objective and ${currency(paid)} recorded as paid for structure. Finishes are quoted at ${currency(finish.quote)} against ${currency(finish.objective)}, a ${currency(finish.excess)} excess. No finish payment has been recorded.`, `Ejemplo preparado de presupuesto: Casa Mirador tiene un objetivo de ${currency(objective)} y ${currency(paid)} pagados en estructura. Los acabados están cotizados en ${currency(finish.quote)} frente a ${currency(finish.objective)}: un exceso de ${currency(finish.excess)}. No hay pagos registrados para acabados.`), citations: [budgetSource] };
  }
  if (/\b(house|dimension|dimensions|measurement|measurements|large|size|casa|mide|medida|medidas|dimension|dimensiones|bedroom|bedrooms|dormitorios|bathroom|bano)\b/.test(normalized)) return {
    text: tr(language, `Prepared house example: Casa Mirador has a fictional ${measurements.find((item) => item.id === "house")!.value} footprint (12 × 10 m), two bedrooms and one bathroom. `, `Ejemplo preparado de casa: Casa Mirador tiene una huella ficticia de ${measurements.find((item) => item.id === "house")!.value} (12 × 10 m), dos dormitorios y un baño. `) + measurements.filter((item) => item.id !== "house").map((item) => `${language === "es" ? item.labelEs : item.labelEn}: ${item.value}`).join("; ") + tr(language, ". The illustration is not a construction drawing.", ". La ilustración no es un plano constructivo."),
    citations: [planSource],
  };
  return unsupported;
}

export default function AssistantPanel(props: Props) {
  return <AssistantPanelContent key={props.mode || "real"} {...props} />;
}

function AssistantPanelContent({ mode = "real", language, role, canBudget, canDocuments, canNotes, onOpenBudget }: Props) {
  const [open, setOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const messageList = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLElement>(null);
  const localPrefix = useId();
  const streamState = useRef<{ text: string; citations: AssistantCitation[]; proposal: AssistantProposal | null }>({ text: "", citations: [], proposal: null });
  useModalFocus(open, panel);

  const suggestions = useMemo(() => mode === "demo" ? [
    ...(canBudget ? [tr(language, "Show the sample budget and excess", "Muestra el presupuesto y el exceso de ejemplo")] : []),
    tr(language, "What are the house dimensions?", "¿Cuáles son las medidas de la casa?"),
    tr(language, "Show the kitchen example", "Muestra el ejemplo de cocina"),
    ...(canNotes ? [tr(language, "What is in the sample project notes?", "¿Qué contienen las notas de ejemplo?")] : []),
  ] : [
    tr(language, "Find the interior doors budget line", "Busca la partida de puertas interiores"),
    tr(language, "How much budget remains?", "¿Cuánto presupuesto queda?"),
    tr(language, "Summarize the contract change rules", "Resume las reglas de cambios del contrato"),
    ...(canNotes ? [tr(language, "What information is saved in the project notes?", "¿Qué información hay guardada en las notas del proyecto?")] : []),
  ], [language, canNotes, canBudget, mode]);

  useEffect(() => {
    if (!open || mode === "demo") return;
    void fetch("/api/assistant/conversations").then((response) => response.ok ? response.json() : Promise.reject()).then((data: { conversations: Conversation[] }) => setConversations(data.conversations)).catch(() => undefined);
  }, [open, mode]);

  useEffect(() => {
    messageList.current?.scrollTo({ top: messageList.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  useEffect(() => {
    if (!open) return;
    const close = (event: globalThis.KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open]);

  const loadConversation = async (id: string) => {
    if (mode === "demo") return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/assistant/conversations?id=${encodeURIComponent(id)}`);
      if (!response.ok) throw new Error("history");
      const data = await response.json() as { conversation: { id: string; messages: AssistantMessage[] } };
      setConversationId(data.conversation.id);
      setMessages(data.conversation.messages);
      setHistoryOpen(false);
    } catch { setError(tr(language, "Conversation history could not be loaded.", "No se pudo cargar el historial.")); }
    finally { setBusy(false); }
  };

  const newConversation = () => {
    setConversationId(null);
    setMessages([]);
    setDraft("");
    setError("");
    setHistoryOpen(false);
  };

  const send = async (textValue?: string) => {
    const text = (textValue ?? draft).trim();
    if (!text || busy) return;
    setDraft("");
    setError("");
    const sequence = messages.length;
    const userMessage: AssistantMessage = { id: `${localPrefix}-user-${sequence}`, role: "user", text, createdAt: "" };
    const assistantId = `${localPrefix}-assistant-${sequence + 1}`;
    setMessages((current) => [...current, userMessage, { id: assistantId, role: "assistant", text: "", createdAt: "", citations: [], proposal: null }]);
    setBusy(true);
    try {
      if (mode === "demo") {
        const answer = preparedDemoAnswer(text, language, canBudget, canNotes);
        setMessages((current) => current.map((message) => message.id === assistantId ? { ...message, ...answer, proposal: null } : message));
        return;
      }
      const response = await fetch("/api/assistant/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conversationId, message: text, language }) });
      if (!response.ok || !response.body) throw new Error("assistant");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      streamState.current = { text: "", citations: [], proposal: null };
      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
        const blocks = buffer.split("\n\n");
        buffer = blocks.pop() || "";
        for (const block of blocks) {
          const eventName = block.match(/^event: (.+)$/m)?.[1];
          const dataLine = block.match(/^data: (.+)$/m)?.[1];
          if (!eventName || !dataLine) continue;
          const data = JSON.parse(dataLine) as Record<string, unknown>;
          if (eventName === "conversation" && typeof data.id === "string") setConversationId(data.id);
          if (eventName === "text_delta") streamState.current = { ...streamState.current, text: streamState.current.text + String(data.delta || "") };
          if (eventName === "citation") streamState.current = { ...streamState.current, citations: [...streamState.current.citations.filter((item) => item.id !== data.id), data as AssistantCitation] };
          if (eventName === "proposal") streamState.current = { ...streamState.current, proposal: proposalFrom(data) };
          if (eventName === "error") throw new Error(String(data.message || "assistant"));
          const next = streamState.current;
          setMessages((current) => current.map((message) => message.id === assistantId ? { ...message, text: next.text, citations: next.citations, proposal: next.proposal } : message));
        }
        if (done) break;
      }
      if (!streamState.current.text) throw new Error("empty");
      void fetch("/api/assistant/conversations").then((res) => res.json()).then((data: { conversations?: Conversation[] }) => data.conversations && setConversations(data.conversations)).catch(() => undefined);
    } catch (cause) {
      setMessages((current) => current.filter((message) => message.id !== assistantId));
      setError(cause instanceof Error && cause.message === "gemini_not_configured"
        ? tr(language, "The assistant has not been configured by the administrator.", "El administrador aún no ha configurado el asistente.")
        : tr(language, "The assistant could not complete that request. Try again.", "El asistente no pudo completar la solicitud. Inténtalo de nuevo."));
    } finally { setBusy(false); }
  };

  const confirmProposal = async (proposalId: string, messageId: string) => {
    if (mode === "demo") return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/assistant/proposals", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: proposalId }) });
      const data = await response.json() as { draftId?: string; error?: string };
      if (!response.ok || !data.draftId) throw new Error(data.error || "proposal");
      setMessages((current) => current.map((message) => message.id === messageId && message.proposal ? { ...message, proposal: { ...message.proposal, status: "confirmed", draftId: data.draftId } } : message));
    } catch (cause) {
      setError(cause instanceof Error && cause.message === "stale_proposal"
        ? tr(language, "The budget changed. Ask the assistant to prepare a new proposal.", "El presupuesto cambió. Pide al asistente que prepare una propuesta nueva.")
        : tr(language, "The draft could not be created.", "No se pudo crear el borrador."));
    } finally { setBusy(false); }
  };

  const onComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); }
  };

  const openBudget = (draftId?: string) => {
    setOpen(false);
    onOpenBudget(draftId);
  };

  return (
    <>
      <button className="assistant-launcher" onClick={() => setOpen(true)} aria-label={tr(language, "Open project assistant", "Abrir asistente del proyecto")}>
        <span>✦</span><b>{tr(language, "Ask assistant", "Preguntar")}</b>
      </button>
      {open && <div className="assistant-backdrop" onMouseDown={() => setOpen(false)} />}
      <aside ref={panel} tabIndex={-1} className={`assistant-panel ${open ? "open" : ""}`} role={open ? "dialog" : undefined} aria-modal={open || undefined} aria-hidden={!open} aria-labelledby={`${localPrefix}-assistant-title`}>
        <header className="assistant-header">
          <div><span>✦</span><div><b id={`${localPrefix}-assistant-title`}>{tr(language, "Project assistant", "Asistente del proyecto")}</b><small>{mode === "demo" ? tr(language, "Scripted demo · no live AI", "Demo preparada · sin IA en vivo") : <>Gemini Pro · {tr(language, "Budget and permitted documents", "Presupuesto y documentos permitidos")}</>}</small></div></div>
          <div>
            <button onClick={() => setHistoryOpen((value) => !value)} aria-label={tr(language, "Conversation history", "Historial")}>◴</button>
            <button onClick={newConversation} aria-label={tr(language, "New conversation", "Nueva conversación")}>＋</button>
            <button onClick={() => setOpen(false)} aria-label={tr(language, "Close assistant", "Cerrar asistente")}>×</button>
          </div>
        </header>
        {historyOpen && <div className="assistant-history">
          <b>{tr(language, "Your conversations", "Tus conversaciones")}</b>
          {conversations.length === 0 && <p>{mode === "demo" ? tr(language, "Demo conversations stay in this panel and are not saved.", "Las conversaciones demo quedan en este panel y no se guardan.") : tr(language, "No saved conversations yet.", "Todavía no hay conversaciones guardadas.")}</p>}
          {conversations.map((conversation) => <button key={conversation.id} onClick={() => void loadConversation(conversation.id)}><b>{conversation.title}</b><small>{conversation.lastMessage}</small></button>)}
        </div>}
        <div className="assistant-messages" ref={messageList} aria-live="polite">
          {messages.length === 0 && <div className="assistant-empty">
            <span>✦</span>
            <h2>{tr(language, "What would you like to check?", "¿Qué quieres revisar?")}</h2>
            <p>{mode === "demo" ? tr(language, "Explore prepared answers from Casa Mirador’s fictional budget, dimensions, kitchen and notes. Choose an example to see the real assistant interface.", "Explora respuestas preparadas del presupuesto, medidas, cocina y notas ficticias de Casa Mirador. Elige un ejemplo para conocer la interfaz real del asistente.") : tr(language, "I can find budget entries, prepare corrections, and answer from documents or AI-enabled notes you may access.", "Puedo buscar partidas, preparar correcciones y responder con documentos o notas habilitadas para IA a los que tienes acceso.")}</p>
            <div>{suggestions.map((suggestion) => <button key={suggestion} onClick={() => void send(suggestion)}>{suggestion}</button>)}</div>
          </div>}
          {messages.map((message) => <article className={`assistant-message ${message.role}`} key={message.id}>
            <span>{message.role === "assistant" ? "✦" : tr(language, "You", "Tú")}</span>
            <div>
              <p>{message.text || (busy ? tr(language, "Reviewing project data…", "Revisando los datos del proyecto…") : "")}</p>
              {message.citations && message.citations.length > 0 && <div className="assistant-citations">
                {message.citations.map((citation) => citation.href
                  ? <a href={citation.href} target="_blank" rel="noopener noreferrer" key={citation.id}>↗ {citation.label}</a>
                  : mode === "demo" && citation.kind !== "budget" ? <span key={citation.id}>{citation.label}</span> : <button key={citation.id} onClick={() => openBudget()}>▦ {citation.label}</button>)}
              </div>}
              {message.proposal && <section className="assistant-proposal">
                <header><div><small>{tr(language, "BUDGET DRAFT PREVIEW", "VISTA PREVIA DEL BORRADOR")}</small><b>{message.proposal.summary}</b></div><em>{message.proposal.changes.length}</em></header>
                {message.proposal.changes.map((change, index) => <div className="assistant-change" key={`${change.lineId}:${change.field}:${index}`}><b>{change.label}</b><span>{change.field}: <del>{String(change.before)}</del> → <ins>{String(change.after)}</ins></span><small>{change.reason}</small></div>)}
                {message.proposal.status === "pending" && role !== "viewer" && <button className="assistant-confirm" disabled={busy} onClick={() => void confirmProposal(message.proposal!.id, message.id)}>{tr(language, "Confirm and create draft", "Confirmar y crear borrador")}</button>}
                {message.proposal.status === "confirmed" && <button className="assistant-open-draft" onClick={() => openBudget(message.proposal?.draftId)}>✓ {tr(language, "Draft created — open budget", "Borrador creado — abrir presupuesto")}</button>}
                <p>{tr(language, "Nothing is published until the normal workbook review is completed.", "Nada se publica hasta completar la revisión normal del libro.")}</p>
              </section>}
            </div>
          </article>)}
        </div>
        {error && <div className="assistant-error" role="alert">{error}</div>}
        <form className="assistant-composer" onSubmit={(event: FormEvent) => { event.preventDefault(); void send(); }}>
          <textarea aria-label={tr(language, "Question for the project assistant", "Pregunta para el asistente del proyecto")} value={draft} disabled={busy} rows={2} maxLength={8000} onKeyDown={onComposerKeyDown} onChange={(event) => setDraft(event.target.value)} placeholder={tr(language, "Ask about the budget, documents, or notes…", "Pregunta sobre el presupuesto, documentos o notas…")} />
          <button disabled={busy || !draft.trim()} aria-label={tr(language, "Send message", "Enviar mensaje")}>↑</button>
          <small>{mode === "demo" ? tr(language, "Scripted demo · no live AI, web search or budget changes. Values are fictional.", "Demo preparada · sin IA en vivo, búsqueda web ni cambios de presupuesto. Datos ficticios.") : !canBudget && !canDocuments && !canNotes ? tr(language, "Your current access does not include budget, documents, or notes.", "Tu acceso actual no incluye presupuesto, documentos ni notas.") : tr(language, "Responses may be inaccurate. Review changes and source files.", "Las respuestas pueden ser inexactas. Revisa los cambios y las fuentes.")}</small>
        </form>
      </aside>
    </>
  );
}
