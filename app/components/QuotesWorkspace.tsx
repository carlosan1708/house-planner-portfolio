"use client";

import { trackUsageInteraction } from "@/lib/usage-client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { OfferComparison } from "@/lib/quote-offers";
import { DEMO_BUDGET_LINES } from "@/lib/demo-project";
import { quoteRecommendationForDisplay } from "@/lib/quote-language";
import { uploadFormData, type UploadProgressState } from "@/lib/upload-progress";
import UploadProgress from "./UploadProgress";
import useModalFocus from "./useModalFocus";

type Language = "es" | "en";
type Source = { title: string; url: string };
type Analysis = {
  offerComparison?: OfferComparison;
  summary: string;
  recommendation: string;
  essentialQuestions: Array<{ question: string; reason: string }>;
  mainRisks: Array<{ risk: string; impact: string; evidence: string }>;
  scopeFindings: Array<{ item: string; finding: string; importance: string }>;
  budgetComparison: Array<{ item: string; quoted: string; budget: string; difference: string }>;
  planFindings: Array<{ reference: string; finding: string }>;
  missingInformation: string[];
  webComparison: { summary: string; sources: Source[]; queries: string[]; status: "ready" | "unavailable" | "not_requested" };
};
type QuoteFile = { name: string; supplier?: string; contentType: string; size: number; fileUrl: string };
type Quote = { id: string; fileName: string; size: number; files: QuoteFile[]; uploadedBy: string; status: "analyzing" | "ready" | "failed"; error: string; referenceIds: string[]; referenceNames: string[]; pastQuoteIds: string[]; pastQuoteNames: string[]; webRequested: boolean; analysis: Analysis | null; createdAt: string; fileUrl: string };
type Reference = { id: string; name: string; contentType: string; createdAt: string };
type Message = { id: string; role: "user" | "assistant"; text: string; sources: Source[] };

const t = (language: Language, en: string, es: string) => language === "es" ? es : en;
const formatSize = (value: number) => value >= 1024 * 1024 ? `${(value / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(value / 1024))} KB`;

function demoQuote(language: Language, kind: "finishes" | "roof" = "finishes"): Quote {
  const finishes = kind === "finishes";
  const line = finishes ? DEMO_BUDGET_LINES.find((item) => item.id === "demo-finishes")! : { quote: 7665, objective: 0, excess: 0, supplier: "Pacific Roofing" };
  const money = (amount: number) => new Intl.NumberFormat(language === "es" ? "es-CR" : "en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(amount);
  const supplier = finishes ? t(language, "Demo Finishes", "Acabados Demo") : t(language, "Pacific Roofing", "Techos del Pacífico");
  const alternative = finishes ? "Interiores Horizonte" : "Techos Mirador";
  const fileName = t(language, finishes ? "Floors and finishes · two suppliers" : "Roof framing and covering", finishes ? "Pisos y acabados · dos proveedores" : "Estructura y cubierta de techo");
  const difference = finishes
    ? t(language, `${money(line.excess)} above the sample objective (3.3%).`, `${money(line.excess)} por encima del objetivo de ejemplo (3,3%).`)
    : t(language, "The three-line sample budget has no roof objective. Record one before assessing the difference.", "El presupuesto de ejemplo de tres partidas no tiene un objetivo de cubierta. Regístralo antes de evaluar la diferencia.");
  const sampleDocument = `/demo/Mirador_${finishes ? "Finishes" : "Roof"}_${language}.txt`;
  return {
    id: `demo-${kind}`, fileName, size: 384, files: [{ name: sampleDocument.split("/").pop()!, supplier, contentType: "text/plain", size: 384, fileUrl: sampleDocument }],
    uploadedBy: "demo", status: "ready", error: "", referenceIds: [finishes ? "demo-finish-plan" : "demo-roof-plan"], referenceNames: [t(language, finishes ? "Sample finish schedule · A-05" : "Sample roof plan · A-04", finishes ? "Tabla de acabados de ejemplo · A-05" : "Plano de cubierta de ejemplo · A-04")], pastQuoteIds: [], pastQuoteNames: [], webRequested: false, createdAt: finishes ? "2026-09-10T15:00:00.000Z" : "2026-09-08T15:00:00.000Z", fileUrl: sampleDocument,
    analysis: {
      summary: finishes ? t(language, `${supplier} quotes USD 15,500 against a USD 15,000 objective: USD 500 above budget. The cheaper offer excludes installation, so compare the same installed scope before committing. No finish payment has been recorded.`, `${supplier} cotiza USD 15.500 frente a un objetivo de USD 15.000: USD 500 de exceso. La oferta menor excluye instalación; compara el mismo alcance instalado antes de comprometerte. No hay pagos registrados para acabados.`) : t(language, `${supplier} quotes USD 7,665 for roof supply and installation. The three-line sample budget has no roof objective; this standalone quote does not establish a budget saving. Confirm drainage, flashing and the final installation scope.`, `${supplier} cotiza USD 7.665 por suministro e instalación de cubierta. El presupuesto de ejemplo de tres partidas no tiene un objetivo de techo; esta cotización independiente no establece un ahorro. Confirma drenajes, botaguas y alcance final de instalación.`),
      recommendation: t(language, finishes ? "Resolve the USD 500 excess through a revised offer or an approved budget change before paying the deposit." : "Define the roof budget and request a complete, fixed-scope offer before paying the deposit.", finishes ? "Resuelve el exceso de USD 500 con una oferta revisada o un cambio de presupuesto aprobado antes del anticipo." : "Define el presupuesto de cubierta y solicita una oferta completa y de alcance cerrado antes de pagar el anticipo."),
      offerComparison: {
        suppliers: [
          { supplier, total: money(line.quote), scope: t(language, finishes ? "Floor and wall finishes, materials and installation" : "Roof framing, panels, accessories and installation", finishes ? "Pisos y enchapes, materiales e instalación" : "Estructura, cubierta, accesorios e instalación"), caveats: t(language, "Tax included; written warranty pending", "Impuesto incluido; garantía escrita pendiente") },
          { supplier: alternative, total: money(finishes ? 14800 : 7300), scope: t(language, "Supply only", "Solo suministro"), caveats: t(language, "Installation excluded", "No incluye instalación") },
        ],
        rows: [
          { item: t(language, "Installation", "Instalación"), values: [{ supplier, detail: t(language, "Included", "Incluida"), evidence: t(language, "Fictional scope · line 4", "Alcance ficticio · partida 4") }, { supplier: alternative, detail: t(language, "Excluded; request a separate price", "Excluida; solicitar precio separado"), evidence: t(language, "Fictional exclusions · note 2", "Exclusiones ficticias · nota 2") }], conclusion: t(language, "Compare installed totals before choosing.", "Compara totales instalados antes de elegir.") },
          { item: t(language, "Payment terms", "Forma de pago"), values: [{ supplier, detail: t(language, "30% deposit / 40% delivery / 30% acceptance", "30% anticipo / 40% entrega / 30% recepción"), evidence: t(language, "Fictional conditions · clause 3", "Condiciones ficticias · cláusula 3") }, { supplier: alternative, detail: t(language, "50% deposit / 50% delivery", "50% anticipo / 50% entrega"), evidence: t(language, "Fictional conditions · clause 2", "Condiciones ficticias · cláusula 2") }], conclusion: t(language, "Keep the final payment tied to acceptance.", "Vincula el pago final a la recepción conforme.") },
          { item: t(language, "Delivery", "Entrega"), values: [{ supplier, detail: t(language, "15 working days after approval", "15 días hábiles tras aprobación"), evidence: t(language, "Fictional schedule · item 6", "Plazo ficticio · punto 6") }, { supplier: alternative, detail: t(language, "10 working days; installation unscheduled", "10 días hábiles; instalación sin programar"), evidence: t(language, "Fictional schedule · item 5", "Plazo ficticio · punto 5") }], conclusion: t(language, "Reserve a delivery slot against the project schedule.", "Reserva la entrega según el cronograma del proyecto.") },
        ],
      },
      essentialQuestions: [
        { question: t(language, "Does the fixed price include every accessory and installation task?", "¿El precio cerrado incluye todos los accesorios y tareas de instalación?"), reason: t(language, "Avoid paying for omissions after the deposit.", "Evita pagar omisiones después del anticipo.") },
        { question: t(language, "What written warranty covers materials and workmanship?", "¿Qué garantía escrita cubre materiales y mano de obra?"), reason: t(language, "The sample offer does not state the claim process or warranty period.", "La oferta de ejemplo no indica el proceso de reclamo ni el plazo de garantía.") },
      ],
      mainRisks: [{ risk: finishes ? t(language, "The preferred offer exceeds the objective", "La oferta preferida supera el objetivo") : t(language, "The cheaper offer has a narrower scope", "La oferta más barata tiene menor alcance"), impact: finishes ? t(language, "The USD 500 excess needs a price revision or an approved budget decision.", "El exceso de USD 500 requiere una revisión de precio o una decisión de presupuesto aprobada.") : t(language, "Additional installation costs could reverse the price advantage.", "La instalación adicional podría eliminar la ventaja de precio."), evidence: t(language, "Example budget and supplier comparison", "Comparación de presupuesto y proveedores de ejemplo") }, { risk: t(language, "Deposit before final measurements", "Anticipo antes de las medidas finales"), impact: t(language, "Changes after ordering may add cost and delay delivery.", "Los cambios después de comprar pueden aumentar el costo y atrasar la entrega."), evidence: t(language, "Example terms · approval milestone", "Condiciones de ejemplo · hito de aprobación") }],
      scopeFindings: [{ item: t(language, "Included scope", "Alcance incluido"), finding: t(language, finishes ? "Materials and installation for the fictional 120 m² house. Confirm room-by-room quantities, skirting, adhesive, grout and waste allowance; electrical work is excluded." : "Roof framing, covering, fasteners and installation for the sample house; confirm gutters and downspouts in the final schedule.", finishes ? "Materiales e instalación para la casa ficticia de 120 m². Confirma cantidades por espacio, rodapiés, adhesivo, fragua y desperdicio; se excluye el trabajo eléctrico." : "Estructura, cubierta, fijaciones e instalación para la casa de ejemplo; confirma canoas y bajantes en el listado final."), importance: t(language, "Fictional example; quantities are not a site measurement.", "Ejemplo ficticio; las cantidades no son una medición de obra.") }],
      budgetComparison: [{ item: t(language, finishes ? "Floors and wall finishes" : "Roof framing and covering", finishes ? "Pisos y enchapes" : "Estructura y cubierta de techo"), quoted: money(line.quote), budget: finishes ? money(line.objective) : t(language, "Not recorded", "No registrado"), difference }],
      planFindings: [{ reference: finishes ? "A-05 · Finish schedule" : "A-04 · B–D / 1–4", finding: t(language, finishes ? "The sample house has two bedrooms and one bathroom. The bathroom needs a wet-area finish and waterproofing scope; confirm this separately from the living-area floor." : "The sample roof detail requires continuous flashing at the wall junction. Ask the supplier to identify this item in the offer.", finishes ? "La casa de ejemplo tiene dos dormitorios y un baño. El baño necesita acabado para zona húmeda e impermeabilización; confírmalo por separado del piso de las áreas secas." : "El detalle de cubierta de ejemplo requiere botaguas continuo en el encuentro con el muro. Pide que el proveedor identifique esta partida en su oferta.") }],
      missingInformation: [t(language, "Signed warranty and exclusions", "Garantía firmada y exclusiones"), t(language, "Final site measurements and acceptance checklist", "Medidas finales en obra y lista de recepción")],
      webComparison: { status: "not_requested", summary: t(language, "This is a scripted example with fictional prices. No live web comparison has been performed.", "Este es un ejemplo preparado con precios ficticios. No se realizó una comparación en internet."), sources: [], queries: [] },
    },
  };
}

function demoMessages(language: Language, quote: Quote): Message[] {
  return [
    { id: `${quote.id}-question`, role: "user", text: t(language, "What should I confirm before paying the deposit?", "¿Qué debo confirmar antes de pagar el anticipo?"), sources: [] },
    { id: `${quote.id}-answer`, role: "assistant", text: t(language, "Example response: confirm the installed scope, final measurements and written warranty. Tie the last payment to a signed acceptance checklist. The comparison below shows why a lower supply-only price is not the final installed cost.", "Respuesta de ejemplo: confirma el alcance instalado, las medidas finales y la garantía escrita. Vincula el último pago a una lista de recepción firmada. La comparación muestra por qué un precio menor de solo suministro no es el costo final instalado."), sources: [{ title: t(language, "Example supplier comparison", "Comparación de proveedores de ejemplo"), url: "#demo-quote-suppliers" }, { title: t(language, "Example plan finding", "Hallazgo del plano de ejemplo"), url: "#demo-quote-plans" }] },
  ];
}

async function responseJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!text) throw new Error(response.ok ? "Empty server response" : `Request failed (${response.status})`);
  let data: T & { error?: string };
  try { data = JSON.parse(text); } catch { throw new Error(`Request failed (${response.status})`); }
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

function Sources({ sources }: { sources: Source[] }) {
  if (!sources.length) return null;
  return <div className="quote-sources">{sources.map((source) => <a key={source.url} href={source.url} target={source.url.startsWith("#") ? undefined : "_blank"} rel="noopener noreferrer">↗ {source.title}</a>)}</div>;
}

type QuotesWorkspaceProps = { language: Language; mode: "demo" | "real"; canEdit: boolean; allowChat?: boolean };
export default function QuotesWorkspace(props: QuotesWorkspaceProps) {
  return <QuotesWorkspaceContent key={props.mode} {...props} />;
}

function QuotesWorkspaceContent({ language, mode, canEdit, allowChat = true }: QuotesWorkspaceProps) {
  const input = useRef<HTMLInputElement>(null);
  const localFileUrls = useRef(new Set<string>());
  const results = useRef<HTMLElement>(null);
  const upload = useRef<HTMLFormElement>(null);
  const deleteDialog = useRef<HTMLElement>(null);
  const [quotes, setQuotes] = useState<Quote[]>(() => mode === "demo" ? [demoQuote(language), demoQuote(language, "roof")] : []);
  const [references, setReferences] = useState<Reference[]>([]);
  const [selectedId, setSelectedId] = useState(mode === "demo" ? "demo-finishes" : "");
  const [messages, setMessages] = useState<Message[]>([]);
  const [localMessages, setLocalMessages] = useState<Record<string, Message[]>>({});
  const [offers, setOffers] = useState<Array<{ id: string; supplier: string; files: File[] }>>([{ id: "first", supplier: "", files: [] }]);
  const files = offers.flatMap((offer) => offer.files);
  const [referenceIds, setReferenceIds] = useState<string[]>([]);
  const [pastQuoteIds, setPastQuoteIds] = useState<string[]>([]);
  const [progress, setProgress] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<UploadProgressState | null>(null);
  const [useWeb, setUseWeb] = useState(true);
  const [chatWeb, setChatWeb] = useState(false);
  const [question, setQuestion] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Quote | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(mode === "real");
  const [error, setError] = useState("");
  useModalFocus(Boolean(deleteTarget), deleteDialog);

  useEffect(() => {
    if (!deleteTarget) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, [deleteTarget]);
  const displayedQuotes = useMemo(() => mode === "demo" ? quotes.map((quote) => quote.id === "demo-finishes" || quote.id === "demo-roof" ? demoQuote(language, quote.id === "demo-roof" ? "roof" : "finishes") : quote) : quotes, [quotes, mode, language]);
  const selected = useMemo(() => displayedQuotes.find((quote) => quote.id === selectedId) || null, [displayedQuotes, selectedId]);
  const displayedMessages = mode === "demo" && selected ? localMessages[selected.id] || demoMessages(language, selected) : messages;
  const uploadSize = files.reduce((sum, file) => sum + file.size, 0);
  const uploadIssue = offers.some((offer) => !offer.files.length) && files.length > 0
    ? t(language, "Add documents to every supplier or remove the empty offer.", "Agrega documentos a cada proveedor o quita la oferta vacía.")
    : files.length > 8
    ? t(language, "Select no more than 8 documents.", "Selecciona un máximo de 8 documentos.")
    : files.some((file) => file.size > 25 * 1024 * 1024)
      ? t(language, "Each document must be 25 MB or less.", "Cada documento debe pesar 25 MB o menos.")
      : uploadSize > 30 * 1024 * 1024
        ? t(language, "The complete package must be 30 MB or less.", "El paquete completo debe pesar 30 MB o menos.")
        : "";
  const progressSteps = [
    ["uploading", t(language, "Uploading the documents", "Subiendo los documentos")],
    ["references", t(language, "Opening plans and past quotes", "Abriendo planos y cotizaciones pasadas")],
    ["storing", t(language, "Saving the originals securely", "Guardando los originales de forma segura")],
    ["budget", t(language, "Loading the official budget", "Cargando el presupuesto oficial")],
    ["reading", t(language, "Finding relevant plan sections", "Buscando las secciones relevantes de los planos")],
    ["structuring", t(language, "Preparing questions, risks and differences", "Preparando preguntas, riesgos y diferencias")],
    ["web", t(language, "Comparing current web prices", "Comparando precios actuales en internet")],
    ["saving", t(language, "Saving the review", "Guardando la revisión")],
    ["complete", t(language, "Review ready", "Revisión lista")],
  ];

  async function load(preferredId = selectedId) {
    if (mode === "demo") return;
    const response = await fetch(`/api/quotes${preferredId ? `?id=${encodeURIComponent(preferredId)}` : ""}`, { cache: "no-store" });
    const data = await responseJson<{ quotes: Quote[]; references: Reference[]; messages: Message[] }>(response);
    setQuotes(data.quotes); setReferences(data.references); setMessages(data.messages || []);
    setSelectedId(preferredId && data.quotes.some((quote) => quote.id === preferredId) ? preferredId : data.quotes[0]?.id || "");
  }

  // The asynchronous completion synchronizes the initial server snapshot with this workspace.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (mode === "real") void load().catch((cause) => setError(cause instanceof Error ? cause.message : "Error")).finally(() => setLoading(false)); }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const urls = localFileUrls.current;
    return () => { for (const url of urls) URL.revokeObjectURL(url); };
  }, []);

  async function selectQuote(id: string) {
    setSelectedId(id); setError("");
    if (mode === "demo") {
      const quote = displayedQuotes.find((item) => item.id === id);
      setMessages(localMessages[id] || (quote ? demoMessages(language, quote) : []));
      revealResults(true);
      return;
    }
    try { await load(id); revealResults(true); } catch (cause) { setError(cause instanceof Error ? cause.message : "Error"); }
  }

  function revealResults(mobileOnly = false) {
    if (mobileOnly && !window.matchMedia("(max-width: 680px), (max-width: 900px) and (max-height: 500px) and (pointer: coarse)").matches) return;
    requestAnimationFrame(() => {
      results.current?.scrollIntoView({ block: "start", behavior: "instant" });
      results.current?.focus({ preventScroll: true });
    });
  }

  function revealUpload() {
    upload.current?.scrollIntoView({ block: "start", behavior: "instant" });
    upload.current?.querySelector<HTMLInputElement>('input:not([type="file"])')?.focus({ preventScroll: true });
  }

  async function analyze(event: FormEvent) {
    event.preventDefault();
    if (!files.length || busy || uploadIssue) return;
    setBusy(true); setError(""); setProgress("uploading"); setUploadProgress(null);
    try {
      if (mode === "demo") {
        const example = demoQuote(language);
        const localFiles = offers.flatMap((offer) => offer.files.map((file) => {
          const fileUrl = URL.createObjectURL(file); localFileUrls.current.add(fileUrl);
          return { name: file.name, supplier: offer.supplier.trim() || t(language, "Example supplier", "Proveedor de ejemplo"), contentType: file.type, size: file.size, fileUrl };
        }));
        const quote: Quote = { ...example, id: `demo-local-${crypto.randomUUID()}`, fileName: t(language, "Example review", "Revisión de ejemplo") + ` · ${files[0].name}`, files: localFiles, size: uploadSize, fileUrl: localFiles[0].fileUrl, createdAt: new Date().toISOString(), referenceIds, referenceNames: references.filter((reference) => referenceIds.includes(reference.id)).map((reference) => reference.name), pastQuoteIds, pastQuoteNames: quotes.filter((quote) => pastQuoteIds.includes(quote.id)).map((quote) => quote.fileName) };
        const conversation = demoMessages(language, quote);
        setQuotes((current) => [quote, ...current]); setSelectedId(quote.id); setMessages(conversation); setLocalMessages((current) => ({ ...current, [quote.id]: conversation }));
        setProgress("complete"); setOffers([{ id: "first", supplier: "", files: [] }]); setReferenceIds([]); setPastQuoteIds([]);
        revealResults(true);
        return;
      }
      const form = new FormData();
      for (const file of files) form.append("files", file);
      let fileOffset = 0;
      form.set("offers", JSON.stringify(offers.map((offer, index) => ({ supplier: offer.supplier.trim() || `${t(language, "Offer", "Oferta")} ${index + 1}`, fileIndexes: offer.files.map(() => fileOffset++) }))));
      form.set("referenceIds", JSON.stringify(referenceIds)); form.set("pastQuoteIds", JSON.stringify(pastQuoteIds)); form.set("useWeb", String(useWeb)); form.set("language", language); form.set("stream", "true");
      let buffer = ""; let completed: Quote | null = null;
      const readEvents = (chunk: string, final = false) => {
        buffer += chunk;
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        if (final) { if (buffer.trim()) lines.push(buffer); buffer = ""; }
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as { type: string; stage?: string; quote?: Quote; error?: string };
          if (event.type === "progress" && event.stage) { setProgress(event.stage); setUploadProgress(null); }
          if (event.type === "complete" && event.quote) completed = event.quote;
          if (event.type === "error") throw new Error(event.error || "The analysis could not be completed");
        }
      };
      const response = await uploadFormData("/api/quotes", form, {
        onProgress: setUploadProgress,
        onResponseText: (chunk, metadata) => { if (metadata.ok && metadata.headers.get("content-type")?.includes("application/x-ndjson")) readEvents(chunk); },
      });
      if (!response.ok || !response.headers.get("content-type")?.includes("application/x-ndjson")) {
        await responseJson(response);
        throw new Error("The server did not start the analysis");
      }
      readEvents("", true);
      if (!completed) throw new Error("The analysis ended without a result");
      setUploadProgress(null); setProgress("complete"); setOffers([{ id: "first", supplier: "", files: [] }]); setReferenceIds([]); setPastQuoteIds([]); if (input.current) input.current.value = "";
      await load((completed as Quote).id);
      revealResults(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Error"); }
    finally { setBusy(false); }
  }

  async function ask(event: FormEvent) {
    event.preventDefault();
    const text = question.trim();
    if (!allowChat || !selected || !text || busy) return;
    setBusy(true); setError(""); setQuestion("");
    const optimistic: Message = { id: `local-${Date.now()}`, role: "user", text, sources: [] };
    setMessages((current) => [...current, optimistic]);
    try {
      if (mode === "demo") {
        const answer: Message = { id: `demo-answer-${crypto.randomUUID()}`, role: "assistant", text: t(language, "Example response: ", "Respuesta de ejemplo: ") + (/budget|price|cost|presupuesto|precio|costo/i.test(text) ? selected.analysis?.budgetComparison.map((item) => `${item.item}: ${item.quoted}. ${item.difference}`).join(" ") : /plan|measure|medida|plano/i.test(text) ? selected.analysis?.planFindings.map((item) => `${item.reference}: ${item.finding}`).join(" ") : selected.analysis?.essentialQuestions.map((item) => `${item.question} ${item.reason}`).join(" ")) + t(language, " This scripted reply illustrates the review conversation; it does not analyze your files or search the web.", " Esta respuesta preparada ilustra la conversación de revisión; no analiza tus archivos ni busca en internet."), sources: [{ title: t(language, "Example supplier comparison", "Comparación de proveedores de ejemplo"), url: "#demo-quote-suppliers" }, { title: t(language, "Example plan finding", "Hallazgo del plano de ejemplo"), url: "#demo-quote-plans" }] };
        const conversation = [...displayedMessages, optimistic, answer];
        setMessages(conversation); setLocalMessages((current) => ({ ...current, [selected.id]: conversation }));
        return;
      }
      const data = await responseJson<{ user: Message; assistant: Message }>(await fetch("/api/quotes/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: selected.id, question: text, language, useWeb: chatWeb }) }));
      setMessages((current) => [...current.filter((message) => message.id !== optimistic.id), data.user, data.assistant]);
    } catch (cause) { setMessages((current) => current.filter((message) => message.id !== optimistic.id)); setQuestion(text); setError(cause instanceof Error ? cause.message : "Error"); }
    finally { setBusy(false); }
  }

  async function deleteQuote() {
    if (!deleteTarget || busy) return;
    const target = deleteTarget;
    setBusy(true); setError("");
    try {
      if (mode === "demo") {
        const remaining = quotes.filter((quote) => quote.id !== target.id);
        for (const file of target.files) if (localFileUrls.current.delete(file.fileUrl)) URL.revokeObjectURL(file.fileUrl);
        setQuotes(remaining); setSelectedId(remaining[0]?.id || ""); setMessages(remaining[0] ? localMessages[remaining[0].id] || demoMessages(language, remaining[0]) : []);
        setDeleteTarget(null); setPastQuoteIds((current) => current.filter((id) => id !== target.id));
        setLocalMessages((current) => { const next = { ...current }; delete next[target.id]; return next; });
        return;
      }
      await responseJson<{ ok: true }>(await fetch(`/api/quotes?id=${encodeURIComponent(target.id)}`, { method: "DELETE" }));
      setDeleteTarget(null);
      setPastQuoteIds((current) => current.filter((id) => id !== target.id));
      const nextId = quotes.find((quote) => quote.id !== target.id)?.id || "";
      await load(nextId);
    } catch (cause) { setDeleteTarget(null); setError(cause instanceof Error ? cause.message : t(language, "The quote could not be deleted", "No se pudo eliminar la cotización")); }
    finally { setBusy(false); }
  }

  const analysis = selected?.analysis;
  return <div className="quotes-workspace">
    <section className="quote-intro">
      <div><span className="eyebrow">{t(language, "QUOTE REVIEW", "REVISIÓN DE COTIZACIONES")}</span><h2>{t(language, "Review before you commit", "Revisa antes de comprometerte")}</h2><p>{t(language, "Compare suppliers, their scope and prices with your budget and plans. Discuss the decision in one conversation.", "Compara proveedores, alcances y precios con tu presupuesto y planos. Conversa sobre la decisión en un mismo chat.")}</p></div>
      <div className="quote-capabilities"><span>◫ {t(language, "Visual plan reading", "Lectura visual de planos")}</span><span>⌕ {t(language, "Current web prices", "Precios actuales en internet")}</span><span>◎ {t(language, "Follow-up questions", "Preguntas de seguimiento")}</span></div>
    </section>

    {mode === "demo" && <p className="quote-demo-notice" role="note">{t(language, "Interactive example · fictional suppliers, USD prices and plan findings. Changes last for this visit; AI replies are scripted examples.", "Ejemplo interactivo · proveedores, precios en USD y hallazgos ficticios. Los cambios duran esta visita; las respuestas de IA son ejemplos preparados.")}</p>}
    {error && <div className="quote-error">{error}</div>}
    <nav className="quote-mobile-navigation" aria-label={t(language, "Quote review navigation", "Navegación de cotizaciones")}>
      {selected && <button className="secondary-button" type="button" onClick={() => revealResults()}>{t(language, "View selected review", "Ver revisión seleccionada")}</button>}
      {canEdit && <button className="secondary-button" type="button" onClick={revealUpload}>{t(language, "New review", "Nueva revisión")}</button>}
    </nav>
    <div className="quote-layout">
      <aside className="quote-sidebar">
        {canEdit && <form ref={upload} className="quote-upload" onSubmit={analyze}>
          <div className="quote-section-title"><b>{t(language, "New review", "Nueva revisión")}</b><small>{t(language, "Up to 8 files · 30 MB total", "Hasta 8 archivos · 30 MB total")}</small></div>
          <p>{mode === "demo" ? t(language, "Try adding documents to create a sample review. Files stay in your browser; their contents are not analyzed.", "Prueba agregar documentos para crear una revisión de ejemplo. Los archivos quedan en tu navegador; no se analiza su contenido.") : t(language, "Keep each supplier’s documents in its own offer.", "Agrupa los documentos de cada proveedor en su propia oferta.")}</p>
          {offers.map((offer, offerIndex) => <fieldset className="quote-offer-input" key={offer.id} disabled={busy}>
            <legend>{t(language, "Offer", "Oferta")} {offerIndex + 1}</legend>
            <input aria-label={t(language, `Supplier ${offerIndex + 1}`, `Proveedor ${offerIndex + 1}`)} placeholder={t(language, "Supplier name", "Nombre del proveedor")} maxLength={120} value={offer.supplier} onChange={(event) => setOffers((current) => current.map((item) => item.id === offer.id ? { ...item, supplier: event.target.value } : item))} />
            <label className="quote-file-picker"><b>{t(language, "Add documents", "Agregar documentos")}</b><input ref={offerIndex === 0 ? input : undefined} type="file" multiple accept=".pdf,.docx,.jpg,.jpeg,.png,.webp" onChange={(event) => { const added = Array.from(event.target.files || []); setOffers((current) => current.map((item) => item.id === offer.id ? { ...item, files: [...item.files, ...added] } : item)); event.target.value = ""; setProgress(null); }} /></label>
            <div className="quote-selected-files">{offer.files.map((file, fileIndex) => <div key={`${file.name}-${fileIndex}`}><span><b>{file.name}</b><small>{formatSize(file.size)}</small></span><button type="button" aria-label={t(language, `Remove ${file.name}`, `Quitar ${file.name}`)} onClick={() => setOffers((current) => current.map((item) => item.id === offer.id ? { ...item, files: item.files.filter((_, index) => index !== fileIndex) } : item))}>×</button></div>)}</div>
            {offers.length > 1 && <button type="button" onClick={() => setOffers((current) => current.filter((item) => item.id !== offer.id))}>{t(language, "Remove offer", "Quitar oferta")}</button>}
          </fieldset>)}
          <button type="button" className="secondary-button" disabled={busy || offers.length >= 5} onClick={() => setOffers((current) => [...current, { id: crypto.randomUUID(), supplier: "", files: [] }])}>{t(language, "＋ Add supplier", "＋ Agregar proveedor")}</button>
          <small>{files.length} / 8 · {formatSize(uploadSize)} / 30 MB</small>
          {uploadIssue && <small className="quote-upload-limit">{uploadIssue}</small>}
          <UploadProgress progress={uploadProgress} language={language} error={Boolean(error)} fileCount={files.length} />
          <details className="quote-references" open={references.length > 0}><summary>{t(language, "Plans and references", "Planos y referencias")} <em>{referenceIds.length}</em></summary>{references.length ? <div>{references.map((reference) => <label key={reference.id}><input type="checkbox" checked={referenceIds.includes(reference.id)} onChange={(event) => setReferenceIds((current) => event.target.checked ? [...current, reference.id].slice(0, 8) : current.filter((id) => id !== reference.id))} /><span>{reference.name}</span></label>)}</div> : <p>{t(language, "In Documents, mark the files you want to use in Quotes.", "En Documentos, marca los archivos que quieras usar en Cotizaciones.")}</p>}</details>
          <details className="quote-references"><summary>{t(language, "Past quotes to compare", "Cotizaciones pasadas para comparar")} <em>{pastQuoteIds.length}</em></summary>{quotes.filter((quote) => quote.status === "ready").length ? <div>{displayedQuotes.filter((quote) => quote.status === "ready").map((quote) => <label key={quote.id}><input type="checkbox" checked={pastQuoteIds.includes(quote.id)} onChange={(event) => setPastQuoteIds((current) => event.target.checked ? [...current, quote.id].slice(0, 5) : current.filter((id) => id !== quote.id))} /><span>{quote.fileName}</span></label>)}</div> : <p>{t(language, "Completed reviews will appear here.", "Las revisiones completadas aparecerán aquí.")}</p>}</details>
          <div className="quote-budget-note"><span>✓</span><div><b>{t(language, "Official budget included automatically", "Presupuesto oficial incluido automáticamente")}</b><small>{t(language, "Objectives, recorded quotes, payments and suppliers", "Objetivos, cotizaciones registradas, pagos y proveedores")}</small></div></div>
          <label className="quote-toggle"><input type="checkbox" checked={mode === "demo" ? false : useWeb} disabled={mode === "demo"} onChange={(event) => setUseWeb(event.target.checked)} /><span><b>{t(language, "Compare prices automatically", "Comparar precios automáticamente")}</b><small>{mode === "demo" ? t(language, "Live web comparison is available in a real project", "La comparación en internet está disponible en un proyecto real") : t(language, "House Planner performs the comparison and shows its sources", "House Planner realiza la comparación y muestra sus fuentes")}</small></span></label>
          <button className="primary-button" disabled={!files.length || Boolean(uploadIssue) || busy}>{busy ? t(language, "Analysis in progress…", "Análisis en progreso…") : mode === "demo" ? t(language, "Create sample review", "Crear revisión de ejemplo") : t(language, "Compare offers", "Comparar ofertas")}</button>
          <div className={`quote-progress ${progress ? "active" : ""}`}><div className="quote-progress-head"><b>{progress ? t(language, "Analysis progress", "Progreso del análisis") : t(language, "Steps in every review", "Pasos de cada revisión")}</b><span>{progress ? `${Math.round(((Math.max(0, progressSteps.findIndex(([id]) => id === progress)) + 1) / progressSteps.length) * 100)}%` : ""}</span></div><i><span style={{ width: progress ? `${((Math.max(0, progressSteps.findIndex(([id]) => id === progress)) + 1) / progressSteps.length) * 100}%` : "0%" }} /></i><ol>{progressSteps.map(([id, label], index) => { const current = progressSteps.findIndex(([stage]) => stage === progress); const state = progress && index < current ? "done" : id === progress ? "current" : ""; return <li key={id} className={state}><span>{state === "done" || id === "complete" && progress === "complete" ? "✓" : index + 1}</span>{label}{id === "web" && <small>{t(language, "optional", "opcional")}</small>}</li>; })}</ol></div>
        </form>}
        <div className="quote-history"><div className="quote-section-title"><b>{t(language, "Previous reviews", "Revisiones anteriores")}</b><small>{quotes.length}</small></div>{loading ? <p>{t(language, "Loading…", "Cargando…")}</p> : quotes.length ? displayedQuotes.map((quote) => <button key={quote.id} className={quote.id === selectedId ? "selected" : ""} onClick={() => void selectQuote(quote.id)}><span>{quote.status === "ready" ? "✓" : quote.status === "failed" ? "!" : "…"}</span><div><b>{quote.fileName}</b><small>{new Date(quote.createdAt).toLocaleDateString(language === "es" ? "es-CR" : "en-US")} · {t(language, quote.files.length === 1 ? "1 file" : `${quote.files.length} files`, quote.files.length === 1 ? "1 archivo" : `${quote.files.length} archivos`)} · {formatSize(quote.size)}</small></div></button>) : <p>{t(language, "No reviews yet.", "Aún no hay revisiones.")}</p>}</div>
      </aside>

      <main ref={results} tabIndex={-1} className="quote-results" aria-label={t(language, "Quote review", "Revisión de cotización")}>
        {!selected && !loading && <div className="quote-empty"><span>⌕</span><b>{t(language, "Your next quote starts here", "Tu próxima cotización comienza aquí")}</b><p>{t(language, "The review will focus on essential questions, main risks, scope gaps, plan conflicts and budget differences.", "La revisión se enfocará en preguntas esenciales, riesgos principales, vacíos de alcance, conflictos con planos y diferencias del presupuesto.")}</p></div>}
        {selected && <div className="quote-record-toolbar"><small>{new Date(selected.createdAt).toLocaleDateString(language === "es" ? "es-CR" : "en-US")} · {t(language, selected.files.length === 1 ? "1 document" : `${selected.files.length} documents`, selected.files.length === 1 ? "1 documento" : `${selected.files.length} documentos`)}</small><div>{selected.files.length > 1 ? <details className="quote-file-menu"><summary>{t(language, "Open documents", "Abrir documentos")} ({selected.files.length})</summary><div>{selected.files.map((file) => <a key={file.fileUrl} onClick={() => trackUsageInteraction("document.open")} href={file.fileUrl} target="_blank" rel="noopener noreferrer">↗ <span>{file.name}</span><small>{file.supplier} · {formatSize(file.size)}</small></a>)}</div></details> : <a className="secondary-button" onClick={() => trackUsageInteraction("document.open")} href={selected.files[0]?.fileUrl || selected.fileUrl} target="_blank" rel="noopener noreferrer">↗ {t(language, "Open original", "Abrir original")}</a>}{canEdit && <button type="button" className="quote-delete-button" disabled={busy || selected.status === "analyzing"} title={selected.status === "analyzing" ? t(language, "Wait for the analysis to finish", "Espera a que termine el análisis") : undefined} onClick={() => setDeleteTarget(selected)}>{t(language, "Delete quote", "Eliminar cotización")}</button>}</div></div>}
        {selected?.status === "failed" && <div className="quote-empty"><span>!</span><b>{t(language, "Analysis failed", "El análisis falló")}</b><p>{selected.error}</p></div>}
        {selected?.status === "analyzing" && <div className="quote-empty"><span className="quote-spinner">◌</span><b>{t(language, "Reading the full quote and plans", "Leyendo la cotización y los planos completos")}</b></div>}
        {selected?.status === "ready" && analysis && <>
          <header className="quote-result-head"><div><span className="eyebrow">{mode === "demo" ? t(language, "EXAMPLE ANALYSIS · FICTIONAL PROJECT", "ANÁLISIS DE EJEMPLO · PROYECTO FICTICIO") : t(language, "ANALYSIS · OFFICIAL BUDGET INCLUDED", "ANÁLISIS · PRESUPUESTO OFICIAL INCLUIDO")}</span><h2>{selected.fileName}</h2><p>{selected.referenceNames.length ? `${t(language, "Plans", "Planos")}: ${selected.referenceNames.join(", ")}` : t(language, "No plan references selected", "Sin planos de referencia seleccionados")}{selected.pastQuoteNames?.length ? ` · ${t(language, "Past quotes", "Cotizaciones pasadas")}: ${selected.pastQuoteNames.join(", ")}` : ""}</p></div></header>
          <section className="quote-verdict"><span>{t(language, "RECOMMENDATION", "RECOMENDACIÓN")}</span><b>{quoteRecommendationForDisplay({ recommendation: analysis.recommendation, webComparisonSummary: analysis.webComparison.status === "ready" ? analysis.webComparison.summary : "", budgetComparisonSummary: analysis.budgetComparison.map((item) => `${item.item}: ${item.difference}`).join(". "), language })}</b><p>{analysis.summary}</p></section>
          {!!analysis.offerComparison?.suppliers.length && <section id={mode === "demo" ? "demo-quote-suppliers" : undefined} className="quote-offer-comparison"><h3>{t(language, "Supplier comparison", "Comparación por proveedor")}</h3><div className="quote-comparison-scroll" tabIndex={0} role="region" aria-label={t(language, "Supplier comparison table", "Tabla de comparación de proveedores")}><table><thead><tr><th>{t(language, "Item", "Concepto")}</th>{analysis.offerComparison.suppliers.map((offer, index) => <th key={index}>{offer.supplier}</th>)}<th>{t(language, "Conclusion", "Conclusión")}</th></tr></thead><tbody>
            <tr><th>{t(language, "Quoted total", "Total cotizado")}</th>{analysis.offerComparison.suppliers.map((offer, index) => <td key={index}><b>{offer.total}</b><p>{offer.scope}</p><small>{offer.caveats}</small></td>)}<td>{t(language, "Original totals; differences in scope are detailed below.", "Totales originales; las diferencias de alcance se detallan abajo.")}</td></tr>
            {analysis.offerComparison.rows.map((row, index) => <tr key={index}><th>{row.item}</th>{analysis.offerComparison!.suppliers.map((offer, supplierIndex) => { const value = row.values.find((cell) => cell.supplier === offer.supplier); return <td key={supplierIndex}>{value?.detail || t(language, "Not stated", "No indicado")}{value?.evidence && <small>{value.evidence}</small>}</td>; })}<td>{row.conclusion}</td></tr>)}
          </tbody></table></div></section>}
          <div className="quote-priority-grid">
            <section><h3>{t(language, "Essential questions", "Preguntas esenciales")}</h3>{analysis.essentialQuestions.length ? <ol>{analysis.essentialQuestions.map((item, index) => <li key={index}><b>{item.question}</b><span>{item.reason}</span></li>)}</ol> : <p>{t(language, "No essential questions identified.", "No se identificaron preguntas esenciales.")}</p>}</section>
            <section className="risks"><h3>{t(language, "Main risks", "Riesgos principales")}</h3>{analysis.mainRisks.length ? <ul>{analysis.mainRisks.map((item, index) => <li key={index}><b>{item.risk}</b><span>{item.impact}</span>{item.evidence && <small>{item.evidence}</small>}</li>)}</ul> : <p>{t(language, "No major risks identified.", "No se identificaron riesgos principales.")}</p>}</section>
          </div>
          {!!analysis.scopeFindings.length && <details className="quote-detail" open><summary>{t(language, "Scope and conditions", "Alcance y condiciones")} <em>{analysis.scopeFindings.length}</em></summary><div>{analysis.scopeFindings.map((item, index) => <article key={index}><b>{item.item}</b><p>{item.finding}</p><small>{item.importance}</small></article>)}</div></details>}
          {!!analysis.budgetComparison.length && <details className="quote-detail"><summary>{t(language, "Official budget comparison", "Comparación con presupuesto oficial")} <em>{analysis.budgetComparison.length}</em></summary><div>{analysis.budgetComparison.map((item, index) => <article key={index}><b>{item.item}</b><p>{item.difference}</p><small>{t(language, "Quote", "Cotización")}: {item.quoted} · {t(language, "Budget", "Presupuesto")}: {item.budget}</small></article>)}</div></details>}
          {!!analysis.planFindings.length && <details id={mode === "demo" ? "demo-quote-plans" : undefined} className="quote-detail"><summary>{t(language, "Findings from plans", "Hallazgos de los planos")} <em>{analysis.planFindings.length}</em></summary><div>{analysis.planFindings.map((item, index) => <article key={index}><b>{item.reference}</b><p>{item.finding}</p></article>)}</div></details>}
          {!!analysis.missingInformation.length && <details className="quote-detail"><summary>{t(language, "Missing information", "Información faltante")} <em>{analysis.missingInformation.length}</em></summary><ul>{analysis.missingInformation.map((item, index) => <li key={index}>{item}</li>)}</ul></details>}
          <section className="quote-web"><header><div><span>⌕</span><div><b>{t(language, "Web price comparison", "Comparación de precios en internet")}</b><small>{mode === "demo" ? t(language, "Example only · no live search", "Solo ejemplo · sin búsqueda en vivo") : t(language, "Current public sources", "Fuentes públicas actuales")}</small></div></div><em>{analysis.webComparison.status === "ready" ? t(language, "Compared", "Comparado") : analysis.webComparison.status === "not_requested" ? t(language, "Not requested", "No solicitada") : t(language, "Unavailable", "No disponible")}</em></header>{analysis.webComparison.summary && <p>{analysis.webComparison.summary}</p>}<Sources sources={analysis.webComparison.sources} /></section>
          <section className="quote-chat"><header><div><span>◎</span><div><b>{t(language, "Question this analysis", "Cuestiona este análisis")}</b><small>{t(language, "Ask about a line, omission, price or plan detail", "Pregunta por una partida, omisión, precio o detalle del plano")}</small></div></div></header><div className="quote-chat-messages">{displayedMessages.length ? displayedMessages.map((message) => <article key={message.id} className={message.role}><b>{message.role === "user" ? t(language, "You", "Tú") : mode === "demo" ? t(language, "Example quote analyst", "Analista de ejemplo") : t(language, "Quote analyst", "Analista de cotizaciones")}</b><p>{message.text}</p><Sources sources={message.sources || []} /></article>) : <p className="quote-chat-empty">{t(language, "Example: Which supplier is best if installation is included?", "Ejemplo: ¿Cuál proveedor conviene si incluyo la instalación?")}</p>}</div>{!allowChat && <p className="quote-chat-empty">{t(language, "This link provides read-only access.", "Este enlace proporciona acceso de solo lectura.")}</p>}<form onSubmit={ask}><textarea disabled={!allowChat} value={question} onChange={(event) => setQuestion(event.target.value)} placeholder={t(language, "Ask a follow-up question…", "Haz una pregunta de seguimiento…")} rows={3} /><div><label><input type="checkbox" disabled={!allowChat || mode === "demo"} checked={mode === "demo" ? false : chatWeb} onChange={(event) => setChatWeb(event.target.checked)} /> {mode === "demo" ? t(language, "Scripted example · no web search", "Ejemplo preparado · sin búsqueda web") : t(language, "Search the web for this answer", "Buscar en internet para esta respuesta")}</label><button className="primary-button" disabled={!allowChat || !question.trim() || busy}>{busy ? "…" : t(language, "Ask", "Preguntar")}</button></div></form></section>
        </>}
      </main>
    </div>
    {deleteTarget && <div className="detail-backdrop aesthetic-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (!busy && event.target === event.currentTarget) setDeleteTarget(null); }}><section ref={deleteDialog} tabIndex={-1} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); if (!busy) setDeleteTarget(null); } }} className="aesthetic-dialog danger" role="alertdialog" aria-modal="true" aria-labelledby="quote-delete-dialog-title"><span className="aesthetic-dialog-icon">×</span><h3 id="quote-delete-dialog-title">{t(language, "Delete quote?", "¿Eliminar cotización?")}</h3><p>{t(language, `“${deleteTarget.fileName}” and its analysis, questions and ${deleteTarget.files.length} original document(s) will be permanently deleted.`, `“${deleteTarget.fileName}”, su análisis, preguntas y ${deleteTarget.files.length} documento(s) original(es) se eliminarán permanentemente.`)}</p><div className="aesthetic-dialog-actions"><button type="button" disabled={busy} onClick={() => setDeleteTarget(null)}>{t(language, "Keep", "Conservar")}</button><button className="danger-button" type="button" disabled={busy} onClick={() => void deleteQuote()}>{busy ? t(language, "Deleting…", "Eliminando…") : t(language, "Delete", "Eliminar")}</button></div></section></div>}
  </div>;
}
