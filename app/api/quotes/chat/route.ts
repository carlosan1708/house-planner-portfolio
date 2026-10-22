import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { requireTabAccess } from "@/lib/auth";
import { firestore, projectBucket } from "@/lib/firebase-admin";
import { answerQuoteQuestion, type QuoteAnalysis, type QuoteInputFile } from "@/lib/quote-analysis";
import { loadReferenceInputs, loadStoredQuoteInputs, quoteBudgetContext } from "@/lib/quote-context";
import { QUOTE_ANALYSES } from "@/lib/project";
import { completedUsageAction } from "@/lib/usage-actions";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  const actor = await requireTabAccess("quotes");
  if (!actor) return NextResponse.json({ error: "Quotes access required" }, { status: 403 });
  if (actor.accessLinkId) return NextResponse.json({ error: "El enlace de lectura no permite añadir mensajes al proyecto." }, { status: 403 });
  if (!projectBucket) return NextResponse.json({ error: "Storage is unavailable" }, { status: 503 });
  const body = await request.json() as { id?: string; question?: string; language?: "en" | "es"; useWeb?: boolean };
  const question = String(body.question || "").trim().slice(0, 3000);
  if (!body.id || !question) return NextResponse.json({ error: "A quote and question are required" }, { status: 400 });
  const ref = firestore.collection(QUOTE_ANALYSES).doc(body.id);
  const document = await ref.get();
  const data = document.data();
  if (!document.exists || data?.projectId !== actor.projectId || data?.status !== "ready" || !data.analysis) return NextResponse.json({ error: "Quote analysis not found" }, { status: 404 });
  let references;
  try { references = await loadReferenceInputs(actor, Array.isArray(data.referenceIds) ? data.referenceIds : []); }
  catch { return NextResponse.json({ error: "A plan reference is no longer available" }, { status: 409 }); }
  const pastDocuments = await Promise.all((Array.isArray(data.pastQuoteIds) ? data.pastQuoteIds : []).slice(0, 5).map((id: string) => firestore.collection(QUOTE_ANALYSES).doc(id).get()));
  const pastQuotes = (await Promise.all(pastDocuments.filter((item) => item.exists && item.data()?.projectId === actor.projectId).map((item) => loadStoredQuoteInputs(item.data())))).flat();
  const quoteFiles: QuoteInputFile[] = await loadStoredQuoteInputs(data);
  if (!quoteFiles.length) return NextResponse.json({ error: "Quote files are no longer available" }, { status: 409 });
  const previous = await ref.collection("messages").orderBy("createdAt", "desc").limit(10).get();
  const history = previous.docs.reverse().map((message) => ({ role: message.data().role === "assistant" ? "model" as const : "user" as const, text: String(message.data().text || "") }));
  const budgetContext = await quoteBudgetContext(actor.projectId, actor.role === "admin" || actor.permissions.budget);
  try {
    const answer = await answerQuoteQuestion({ language: body.language === "en" ? "en" : "es", question, analysis: data.analysis as QuoteAnalysis, quoteFiles, references, pastQuotes, budgetContext, history, useWeb: body.useWeb === true });
    const batch = firestore.batch();
    const userMessage = ref.collection("messages").doc();
    const assistantMessage = ref.collection("messages").doc();
    const messageTime = Date.now();
    batch.set(userMessage, { role: "user", text: question, createdBy: actor.email, createdAt: Timestamp.fromMillis(messageTime) });
    batch.set(assistantMessage, { role: "assistant", text: answer.text, sources: answer.sources, createdAt: Timestamp.fromMillis(messageTime + 1) });
    batch.set(ref, { updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    await batch.commit();
    await completedUsageAction(actor, "quote.message", "quotes", userMessage.id);
    return NextResponse.json({ user: { id: userMessage.id, role: "user", text: question, sources: [] }, assistant: { id: assistantMessage.id, role: "assistant", ...answer } });
  } catch (error) {
    console.error("Quote question failed", error);
    return NextResponse.json({ error: "The question could not be answered right now" }, { status: 502 });
  }
}
