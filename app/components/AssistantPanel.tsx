"use client";

import { FormEvent, KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import type { AssistantCitation, AssistantMessage, AssistantProposal, AssistantStage } from "@/lib/assistant";
import { AGENT_FILE_LIMIT, AGENT_FILE_TYPES, formatAssistantActionFeedback, type AgentFields, type AgentOutcome, type AgentRunView, type AgentView, type ImageProgress } from "@/lib/assistant-run-types";
import { workspacePathWithLanguage } from "@/lib/workspace-navigation";
import { AssistantAnswer, AssistantSources } from "./AssistantAnswer";
import AssistantRunCard, { AssistantActionResults } from "./AssistantRunCard";
import AssistantImage from "./AssistantImage";
import useModalFocus from "./useModalFocus";
import { DEMO_BUDGET_LINES, DEMO_PROPERTY_PROFILE } from "@/lib/demo-project";
import { demoProjectNotes } from "@/lib/demo-notes";

type Language = "en" | "es";
type Conversation = { id: string; title: string; lastMessage: string; updatedAt: string };
type Props = {
  mode?: "demo" | "real";
  projectId?: string;
  language: Language;
  role: "admin" | "editor" | "viewer";
  canBudget: boolean;
  canDocuments: boolean;
  canNotes: boolean;
  canExpenses?: boolean;
  onOpenBudget: (draftId?: string) => void;
};

const tr = (language: Language, en: string, es: string) => language === "es" ? es : en;

const stageLabels = {
  thinking: ["Starting your request…", "Iniciando la consulta…"],
  answering: ["Preparing an answer…", "Preparando la respuesta…"],
  documents: ["Searching documents and receipts…", "Buscando en documentos y comprobantes…"],
  notes: ["Searching project notes…", "Buscando en las notas del proyecto…"],
  budget: ["Checking the budget…", "Consultando el presupuesto…"],
  proposal: ["Preparing a budget proposal…", "Preparando una propuesta de presupuesto…"],
  verifying: ["Verifying access to sources…", "Verificando el acceso a las fuentes…"],
} satisfies Record<AssistantStage, [string, string]>;

const imageStageLabels = {
  reading: ["Opening the selected plan…", "Abriendo el plano elegido…"],
  analyzing: ["Analyzing plan sheets…", "Analizando las láminas del plano…"],
  generating: ["Generating the visualization…", "Generando la visualización…"],
  saving: ["Saving the image to the conversation…", "Guardando la imagen en la conversación…"],
} satisfies Record<ImageProgress["stage"], [string, string]>;

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
  return <AssistantPanelContent key={JSON.stringify([props.mode, props.projectId])} {...props} />;
}

function AssistantPanelContent({ mode = "real", projectId, language, role, canBudget, canDocuments, canNotes, canExpenses, onOpenBudget }: Props) {
  const [open, setOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [run, setRun] = useState<AgentRunView | null>(null);
  const [attachment, setAttachment] = useState<File | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<AssistantStage | null>(null);
  const [error, setError] = useState("");
  const messageList = useRef<HTMLDivElement>(null);
  const uploadInput = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLElement>(null);
  const localPrefix = useId();
  const requests = useRef<AbortController | null>(null);
  const historyUrl = projectId ? `/api/assistant/conversations?project=${encodeURIComponent(projectId)}` : "/api/assistant/conversations";
  const streamState = useRef<{ text: string; citations: AssistantCitation[]; proposal: AssistantProposal | null; view: AgentView | null; actions: AgentOutcome[] }>({ text: "", citations: [], proposal: null, view: null, actions: [] });
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
    const controller = new AbortController();
    requests.current = controller;
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!open || mode === "demo") return;
    void fetch(historyUrl, { signal: requests.current?.signal }).then((response) => response.ok ? response.json() : Promise.reject()).then((data: { conversations: Conversation[] }) => setConversations(data.conversations)).catch(() => undefined);
  }, [open, mode, historyUrl]);

  const monitorImage = Boolean(run?.imageProgress || (busy && run?.imageWorkflow));
  useEffect(() => {
    if (!open || !conversationId || !monitorImage) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const response = await fetch(`${historyUrl}${projectId ? "&" : "?"}id=${encodeURIComponent(conversationId)}`, { signal: controller.signal });
        if (controller.signal.aborted) return;
        if (response.status === 403 || response.status === 404) {
          setRun(previous => previous ? { ...previous, imageProgress: undefined } : previous);
          controller.abort();
          return;
        }
        if (!response.ok) return;
        const { conversation } = await response.json() as { conversation: { messages: AssistantMessage[]; run?: AgentRunView | null } };
        if (controller.signal.aborted || (busy && !conversation.run?.imageProgress)) return;
        const next = conversation.run ?? null;
        setRun(previous => previous && next && next.revision < previous.revision ? previous : next);
        if (!busy && !next?.imageProgress) {
          setMessages(conversation.messages);
          setError("");
        }
      } catch {
        // A temporary polling failure does not stop the server request.
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(() => void poll(), 3500);
      }
    };
    timer = setTimeout(() => void poll(), 2000);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [busy, conversationId, historyUrl, monitorImage, open, projectId]);

  useEffect(() => {
    messageList.current?.scrollTo({ top: messageList.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  useEffect(() => {
    if (!open) return;
    const close = (event: globalThis.KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open]);

  const applyView = (view?: AgentView | null) => {
    if (!view?.href || !projectId) return;
    const url = new URL(workspacePathWithLanguage(view.href, language), window.location.origin);
    if (url.origin !== window.location.origin) return;
    if (url.pathname.startsWith(`/projects/${encodeURIComponent(projectId)}/`)) {
      window.location.assign(url.href);
    } else if ((url.pathname === "/api/files" || url.pathname === "/api/quotes") && url.searchParams.get("project") === projectId) {
      window.open(url.href, "_blank", "noopener,noreferrer");
    }
  };

  const loadConversation = async (id: string) => {
    if (mode === "demo" || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`${historyUrl}${projectId ? "&" : "?"}id=${encodeURIComponent(id)}`, { signal: requests.current?.signal });
      if (!response.ok) throw new Error("history");
      const data = await response.json() as { conversation: { id: string; messages: AssistantMessage[]; run?: AgentRunView | null } };
      setConversationId(data.conversation.id);
      setMessages(data.conversation.messages);
      setRun(data.conversation.run || null);
      setAttachment(null);
      setHistoryOpen(false);
    } catch { setError(tr(language, "Conversation history could not be loaded.", "No se pudo cargar el historial.")); }
    finally { setBusy(false); }
  };

  const newConversation = () => {
    setConversationId(null);
    setMessages([]);
    setRun(null);
    setAttachment(null);
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
      setStage("thinking");
      const params = new URLSearchParams(window.location.search);
      const selection = params.get("expenseRecord") || params.get("budgetLine") || undefined;
      let payload: BodyInit;
      let headers: HeadersInit | undefined;
      if (attachment) {
        const form = new FormData();
        form.set("attachment", attachment);
        form.set("message", text);
        form.set("language", language);
        if (projectId) form.set("projectId", projectId);
        if (conversationId) form.set("conversationId", conversationId);
        if (selection) form.set("selection", selection);
        payload = form;
      } else {
        headers = { "Content-Type": "application/json" };
        payload = JSON.stringify({ projectId, conversationId, message: text, language, selection });
      }
      const response = await fetch("/api/assistant/chat", { method: "POST", signal: requests.current?.signal, headers, body: payload });
      if (!response.ok || !response.body) throw new Error("assistant");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      streamState.current = { text: "", citations: [], proposal: null, view: null, actions: [] };
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
          if (eventName === "status") {
            if (typeof data.state === "string" && Object.hasOwn(stageLabels, data.state)) setStage(data.state as AssistantStage);
            continue;
          }
          if (eventName === "conversation" && typeof data.id === "string") setConversationId(data.id);
          if (eventName === "text_delta") streamState.current = { ...streamState.current, text: streamState.current.text + String(data.delta || "") };
          if (eventName === "citation") streamState.current = { ...streamState.current, citations: [...streamState.current.citations.filter((item) => item.id !== data.id), data as AssistantCitation] };
          if (eventName === "run") setRun(data.run as AgentRunView | null);
          if (eventName === "actions" && Array.isArray(data.actions)) streamState.current = { ...streamState.current, actions: data.actions as AgentOutcome[] };
          if (eventName === "view") streamState.current = { ...streamState.current, view: data as AgentView };
          if (eventName === "proposal") streamState.current = { ...streamState.current, proposal: proposalFrom(data) };
          if (eventName === "error") throw new Error(String(data.message || "assistant"));
          const next = streamState.current;
          setMessages((current) => current.map((message) => message.id === assistantId ? { ...message, text: next.text, citations: next.citations, proposal: next.proposal, view: next.view, actions: next.actions } : message));
        }
        if (done) break;
      }
      if (!streamState.current.text) throw new Error("empty");
      setAttachment(null);
      applyView(streamState.current.view);
      void fetch(historyUrl, { signal: requests.current?.signal }).then((res) => res.json()).then((data: { conversations?: Conversation[] }) => data.conversations && setConversations(data.conversations)).catch(() => undefined);
    } catch (cause) {
      setMessages((current) => current.filter((message) => message.id !== assistantId));
      setError(cause instanceof Error && cause.message === "gemini_not_configured"
        ? tr(language, "The assistant has not been configured by the administrator.", "El administrador aún no ha configurado el asistente.")
        : tr(language, "The assistant could not complete that request. Try again.", "El asistente no pudo completar la solicitud. Inténtalo de nuevo."));
    } finally {
      setStage(null);
      setBusy(false);
    }
  };

  const respond = async (action: "answer" | "approve" | "retry" | "continue" | "cancel" | "save", input?: { answer?: string; fields?: AgentFields }) => {
    if (!run || !conversationId || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/assistant/runs", {
        method: "POST", signal: requests.current?.signal, headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, conversationId, id: run.id, revision: run.revision, action, ...input }),
      });
      if (!response.ok) {
        const failure = await response.json().catch(() => null) as { error?: string } | null;
        throw Object.assign(new Error(failure?.error || "action"), { status: response.status });
      }
      const data = await response.json() as { conversation: { messages: AssistantMessage[]; run?: AgentRunView | null }; view?: AgentView | null };
      setMessages(data.conversation.messages);
      setRun(data.conversation.run || null);
      applyView(data.view);
    } catch (failure) {
      if (run.imageWorkflow && action !== "cancel") {
        if (failure instanceof Error && failure.message === "image_capacity") {
          setError(tr(language, "The assistant is processing another image. Try again in a moment.", "El asistente está procesando otra imagen. Volvé a intentar en un momento."));
          return;
        }
        if (failure instanceof Error && "status" in failure && failure.status === 403) {
          setError(tr(language, "This plan or conversation is no longer accessible.", "Ya no tenés acceso a este plano o conversación."));
          return;
        }
        setRun(previous => previous?.id === run.id ? { ...previous, imageProgress: previous.imageProgress ?? { stage: "reading" } } : previous);
        return;
      }
      setError(tr(language, "This action could not continue. Reopen the conversation to see its latest state.", "No se pudo continuar. Volvé a abrir la conversación para ver su estado."));
    } finally { setBusy(false); }
  };

  const removeConversation = async (id: string) => {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`${historyUrl}${projectId ? "&" : "?"}id=${encodeURIComponent(id)}`, { method: "DELETE", signal: requests.current?.signal });
      if (!response.ok) throw new Error("delete");
      setConversations((items) => items.filter((item) => item.id !== id));
      if (conversationId === id) {
        newConversation();
        setHistoryOpen(true);
      }
      setDeleteId(null);
    } catch {
      setError(tr(language, "Could not delete the conversation. Try again.", "No se pudo eliminar la conversación. Intentá de nuevo."));
    } finally { setBusy(false); }
  };

  const confirmProposal = async (proposalId: string, messageId: string) => {
    if (mode === "demo") return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/assistant/proposals", { method: "POST", signal: requests.current?.signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: proposalId }) });
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
          <div><span>✦</span><div><b id={`${localPrefix}-assistant-title`}>{tr(language, "Project assistant", "Asistente del proyecto")}</b><small>{mode === "demo" ? tr(language, "Scripted demo · no live AI", "Demo preparada · sin IA en vivo") : tr(language, "Budget, documents and payments", "Presupuesto, documentos y pagos")}</small></div></div>
          <div>
            <button onClick={() => setHistoryOpen((value) => !value)} aria-expanded={historyOpen} title={tr(language, "Conversation history", "Historial")} aria-label={tr(language, "Conversation history", "Historial")}>◴</button>
            <button disabled={busy} onClick={newConversation} aria-label={tr(language, "New conversation", "Nueva conversación")}>＋</button>
            <button onClick={() => setOpen(false)} aria-label={tr(language, "Close assistant", "Cerrar asistente")}>×</button>
          </div>
        </header>
        {historyOpen && <div className="assistant-history">
          <b>{tr(language, "Your conversations", "Tus conversaciones")}</b>
          {conversations.length === 0 && <p>{mode === "demo" ? tr(language, "Demo conversations stay in this panel and are not saved.", "Las conversaciones demo quedan en este panel y no se guardan.") : tr(language, "No saved conversations yet.", "Todavía no hay conversaciones guardadas.")}</p>}
          {conversations.map((conversation) => <div className="assistant-history-item" key={conversation.id}>
            <button disabled={busy} onClick={() => void loadConversation(conversation.id)}><b>{conversation.title}</b><small>{formatAssistantActionFeedback(conversation.lastMessage, language)}</small></button>
            {deleteId === conversation.id ? <div className="assistant-history-delete"><button disabled={busy} onClick={() => void removeConversation(conversation.id)}>{tr(language, "Delete conversation", "Eliminar conversación")}</button><button disabled={busy} onClick={() => setDeleteId(null)}>{tr(language, "Keep", "Conservar")}</button></div>
              : <button disabled={busy} className="assistant-history-delete" onClick={() => setDeleteId(conversation.id)} aria-label={`${tr(language, "Delete conversation", "Eliminar conversación")} ${conversation.title}`}>×</button>}
          </div>)}
        </div>}
        <div className="assistant-messages" ref={messageList} aria-live="polite">
          {messages.length === 0 && <div className="assistant-empty">
            <span>✦</span>
            <h2>{tr(language, "What would you like to check?", "¿Qué quieres revisar?")}</h2>
            <p>{mode === "demo" ? tr(language, "Explore prepared answers from Casa Mirador’s fictional budget, dimensions, kitchen and notes. Choose an example to see the real assistant interface.", "Explora respuestas preparadas del presupuesto, medidas, cocina y notas ficticias de Casa Mirador. Elige un ejemplo para conocer la interfaz real del asistente.") : tr(language, "Ask about your project, record a payment, attach a receipt, or create a reminder.", "Preguntá sobre el proyecto, registrá un pago, adjuntá un comprobante o creá un recordatorio.")}</p>
            <div>{suggestions.map((suggestion) => <button key={suggestion} onClick={() => void send(suggestion)}>{suggestion}</button>)}</div>
          </div>}
          {messages.map((message) => <article className={`assistant-message ${message.role}`} key={message.id}>
            <span>{message.role === "assistant" ? "✦" : tr(language, "You", "Tú")}</span>
            <div>
              {message.text ? (message.role === "assistant"
                ? <AssistantAnswer text={formatAssistantActionFeedback(message.text, language)} citations={message.citations || []} />
                : <p>{message.text}</p>) : message.role === "assistant" && stage && <p className="assistant-progress">
                <span className="assistant-progress-spinner" aria-hidden="true" />
                {tr(language, ...stageLabels[stage])}
              </p>}
              {message.citations?.length ? <AssistantSources citations={message.citations} language={language} onOpenBudget={() => openBudget()} /> : null}
              {message.image && <AssistantImage image={message.image} language={language} />}
              {message.actions && <AssistantActionResults language={language} actions={message.actions.filter((action) =>
                !run?.completed.some((item) => item.tool === action.tool && item.id === action.id))} />}
              {message.view && <div className="assistant-citations"><a href={workspacePathWithLanguage(message.view.href, language)}>{tr(language, "Open requested view", "Abrir la vista solicitada")}</a></div>}
              {message.proposal && <section className="assistant-proposal">
                <header><div><small>{tr(language, "BUDGET DRAFT PREVIEW", "VISTA PREVIA DEL BORRADOR")}</small><b>{message.proposal.summary}</b></div><em>{message.proposal.changes.length}</em></header>
                {message.proposal.changes.map((change, index) => <div className="assistant-change" key={`${change.lineId}:${change.field}:${index}`}><b>{change.label}</b><span>{change.field}: <del>{String(change.before)}</del> → <ins>{String(change.after)}</ins></span><small>{change.reason}</small></div>)}
                {message.proposal.status === "pending" && role !== "viewer" && <button className="assistant-confirm" disabled={busy} onClick={() => void confirmProposal(message.proposal!.id, message.id)}>{tr(language, "Confirm and create draft", "Confirmar y crear borrador")}</button>}
                {message.proposal.status === "confirmed" && <button className="assistant-open-draft" onClick={() => openBudget(message.proposal?.draftId)}>✓ {tr(language, "Draft created — open budget", "Borrador creado — abrir presupuesto")}</button>}
                <p>{tr(language, "Nothing is published until the normal workbook review is completed.", "Nada se publica hasta completar la revisión normal del libro.")}</p>
              </section>}
            </div>
          </article>)}
          {monitorImage && <p className="assistant-progress" role="status" aria-live="polite">
            <span className="assistant-progress-spinner" aria-hidden="true" />
            {tr(language, ...imageStageLabels[run?.imageProgress?.stage ?? "reading"])}
            {run?.imageProgress?.total ? ` ${run.imageProgress.current ?? 0}/${run.imageProgress.total}` : ""}
          </p>}
          {run && <AssistantRunCard run={run} language={language} busy={busy} onRespond={(action, input) => void respond(action, input)} />}
        </div>
        {error && <div className="assistant-error" role="alert">{error}</div>}
        <form className="assistant-composer" onSubmit={(event: FormEvent) => { event.preventDefault(); void send(); }}>
          <textarea aria-label={tr(language, "Question for the project assistant", "Pregunta para el asistente del proyecto")} value={draft} disabled={busy} rows={2} maxLength={8000} onKeyDown={onComposerKeyDown} onChange={(event) => setDraft(event.target.value)} placeholder={tr(language, "Ask about the budget, documents, or notes…", "Pregunta sobre el presupuesto, documentos o notas…")} />
          <button disabled={busy || !draft.trim()} aria-label={tr(language, "Send message", "Enviar mensaje")}>↑</button>
          {mode === "real" && canExpenses && role !== "viewer" && <div className="assistant-attachment">
            {attachment ? <><span>{attachment.name}</span><button type="button" disabled={busy} onClick={() => setAttachment(null)}>{tr(language, "Remove", "Quitar")}</button></>
              : <><button className="assistant-attach-button" type="button" disabled={busy || run?.active} onClick={() => uploadInput.current?.click()}>
                <span aria-hidden="true">+</span> {tr(language, "Attach invoice or receipt", "Adjuntar factura o comprobante")}
              </button><input ref={uploadInput} hidden type="file" accept={AGENT_FILE_TYPES.join(",")} disabled={busy || run?.active} onChange={(event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                if (file.size > AGENT_FILE_LIMIT || !AGENT_FILE_TYPES.some((type) => type === file.type)) {
                  setError(tr(language, "Choose a PDF or supported image up to 8 MB.", "Elegí un PDF o una imagen compatible de hasta 8 MB."));
                  return;
                }
                setError("");
                setAttachment(file);
              }} /></>}
          </div>}
          <small>{mode === "demo" ? tr(language, "Scripted demo · no live AI, web search or budget changes. Values are fictional.", "Demo preparada · sin IA en vivo, búsqueda web ni cambios de presupuesto. Datos ficticios.") : !canBudget && !canDocuments && !canNotes ? tr(language, "Your current access does not include budget, documents, or notes.", "Tu acceso actual no incluye presupuesto, documentos ni notas.") : tr(language, "Check sources and review changes.", "Verificá las fuentes y revisá los cambios.")}</small>
        </form>
      </aside>
    </>
  );
}
