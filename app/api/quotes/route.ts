import { projectCurrency } from "@/lib/currency";
import { lockProjectCurrency } from "@/lib/project-currency";
import { parseOfferAssignments } from "@/lib/quote-offers";
import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { requireTabAccess } from "@/lib/auth";
import { firestore, projectBucket } from "@/lib/firebase-admin";
import { analyzeQuote, type QuoteAnalysis, type QuoteInputFile } from "@/lib/quote-analysis";
import { isQuoteDocument, loadReferenceInputs, loadStoredQuoteInputs, permittedReferenceDocuments, quoteBudgetContext, quoteMime, storedQuoteFiles, storedQuoteLabel } from "@/lib/quote-context";
import { QUOTE_ANALYSES, projectStoragePrefix } from "@/lib/project";
import { completedUsageAction } from "@/lib/usage-actions";
import { loadProjectAuthorDisplay, type ProjectAuthorDisplay } from "@/lib/project-authors";

export const runtime = "nodejs";
export const maxDuration = 300;

function iso(value: unknown) {
  return typeof value === "object" && value && "toDate" in value
    ? (value as FirebaseFirestore.Timestamp).toDate().toISOString()
    : new Date(0).toISOString();
}

function publicQuote(document: FirebaseFirestore.DocumentSnapshot, authors?: ProjectAuthorDisplay) {
  const original = document.data()!;
  const data = authors ? authors.redact(original) : original;
  const files = storedQuoteFiles(data);
  return {
    id: document.id,
    fileName: String(data.title || files[0]?.name || "Quote"),
    contentType: files[0]?.contentType || "",
    size: files.reduce((sum, file) => sum + file.size, 0),
    files: files.map((file, index) => ({ name: file.name, supplier: file.supplier || "", contentType: file.contentType, size: file.size, fileUrl: `/api/quotes?id=${encodeURIComponent(document.id)}&file=1&index=${index}` })),
    uploadedBy: String(data.uploadedBy || ""),
    status: data.status === "ready" || data.status === "failed" ? data.status : "analyzing",
    error: data.status === "failed" ? String(data.error || "Analysis could not be completed") : "",
    referenceIds: Array.isArray(data.referenceIds) ? data.referenceIds.filter((id): id is string => typeof id === "string") : [],
    referenceNames: Array.isArray(data.referenceNames) ? data.referenceNames.filter((name): name is string => typeof name === "string") : [],
    pastQuoteIds: Array.isArray(data.pastQuoteIds) ? data.pastQuoteIds.filter((id): id is string => typeof id === "string") : [],
    pastQuoteNames: Array.isArray(data.pastQuoteNames) ? data.pastQuoteNames.filter((name): name is string => typeof name === "string") : [],
    webRequested: data.webRequested === true,
    analysis: data.analysis && typeof data.analysis === "object" ? data.analysis as QuoteAnalysis : null,
    createdAt: iso(data.createdAt),
    updatedAt: iso(data.updatedAt || data.createdAt),
    fileUrl: `/api/quotes?id=${encodeURIComponent(document.id)}&file=1&index=0`,
  };
}

export async function GET(request: Request) {
  const actor = await requireTabAccess("quotes");
  if (!actor) return NextResponse.json({ error: "Quotes access required" }, { status: 403 });
  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  if (id && url.searchParams.get("file") === "1") {
    if (!projectBucket) return NextResponse.json({ error: "Storage is unavailable" }, { status: 503 });
    const document = await firestore.collection(QUOTE_ANALYSES).doc(id).get();
    if (!document.exists || document.data()?.projectId !== actor.projectId) return NextResponse.json({ error: "Quote not found" }, { status: 404 });
    const data = document.data()!;
    const files = storedQuoteFiles(data);
    const index = Number(url.searchParams.get("index") || 0);
    const file = Number.isInteger(index) && index >= 0 ? files[index] : undefined;
    if (!file) return NextResponse.json({ error: "Quote file not found" }, { status: 404 });
    const [bytes] = await projectBucket.file(file.objectKey).download();
    return new Response(new Uint8Array(bytes), { headers: {
      "Content-Type": file.contentType || "application/octet-stream",
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(file.name || "quote")}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    } });
  }
  const [snapshot, references] = await Promise.all([
    firestore.collection(QUOTE_ANALYSES).where("projectId", "==", actor.projectId).get(),
    permittedReferenceDocuments(actor),
  ]);
  const authors = await loadProjectAuthorDisplay(actor.projectId);
  const quotes = snapshot.docs.map((document) => publicQuote(document, authors)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  let messages: Array<{ id: string; role: "user" | "assistant"; text: string; sources: Array<{ title: string; url: string }>; createdAt: string }> = [];
  const messageQuoteId = id || quotes[0]?.id;
  if (messageQuoteId) {
    const quote = snapshot.docs.find((document) => document.id === messageQuoteId);
    if (!quote) return NextResponse.json({ error: "Quote not found" }, { status: 404 });
    const messageSnapshot = await quote.ref.collection("messages").orderBy("createdAt", "asc").limit(100).get();
    messages = messageSnapshot.docs.map((message) => ({
      id: message.id,
      role: message.data().role === "assistant" ? "assistant" : "user",
      text: String(message.data().text || ""),
      sources: Array.isArray(message.data().sources) ? message.data().sources : [],
      createdAt: iso(message.data().createdAt),
    }));
  }
  return NextResponse.json({
    quotes,
    messages,
    references: references.map((document) => ({ id: document.id, name: String(document.data().fileName || "Reference"), contentType: String(document.data().contentType || ""), createdAt: iso(document.data().createdAt) }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  });
}

export async function POST(request: Request) {
  const actor = await requireTabAccess("quotes", ["admin", "editor"]);
  if (!actor) return NextResponse.json({ error: "Quotes editor access required" }, { status: 403 });
  if (!projectBucket) return NextResponse.json({ error: "Storage is unavailable" }, { status: 503 });
  const bucket = projectBucket;
  const form = await request.formData();
  const files = [...form.getAll("file"), ...form.getAll("files")].filter((value): value is File => value instanceof File);
  if (!files.length) return NextResponse.json({ error: "At least one quote document is required" }, { status: 400 });
  if (files.length > 8) return NextResponse.json({ error: "A quote package is limited to 8 documents" }, { status: 413 });
  if (files.some((file) => file.size > 25 * 1024 * 1024) || files.reduce((sum, file) => sum + file.size, 0) > 30 * 1024 * 1024)
    return NextResponse.json({ error: "Each file is limited to 25 MB and the package to 30 MB" }, { status: 413 });
  if (files.some((file) => !isQuoteDocument(file.name, file.type))) return NextResponse.json({ error: "Use PDF, DOCX, JPG, PNG or WEBP files" }, { status: 415 });
  let offers;
  try { offers = parseOfferAssignments(form.has("offers") ? JSON.parse(String(form.get("offers"))) : null, files.length); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid offers" }, { status: 400 }); }
  const supplierByFile = new Map(offers.flatMap((offer) => offer.fileIndexes.map((index) => [index, offer.supplier] as const)));
  let referenceIds: string[] = [];
  try { referenceIds = JSON.parse(String(form.get("referenceIds") || "[]")); } catch { return NextResponse.json({ error: "Invalid references" }, { status: 400 }); }
  if (!Array.isArray(referenceIds) || referenceIds.some((id) => typeof id !== "string")) return NextResponse.json({ error: "Invalid references" }, { status: 400 });
  let pastQuoteIds: string[] = [];
  try { pastQuoteIds = JSON.parse(String(form.get("pastQuoteIds") || "[]")); } catch { return NextResponse.json({ error: "Invalid past quotes" }, { status: 400 }); }
  if (!Array.isArray(pastQuoteIds) || pastQuoteIds.some((id) => typeof id !== "string")) return NextResponse.json({ error: "Invalid past quotes" }, { status: 400 });
  const language = form.get("language") === "en" ? "en" : "es";
  const useWeb = form.get("useWeb") !== "false";
  const uploads = await Promise.all(files.map(async (file) => ({ file, bytes: Buffer.from(await file.arrayBuffer()), contentType: quoteMime(file.name, file.type) })));
  const run = async (progress: (stage: string) => void = () => undefined) => {
    const ref = firestore.collection(QUOTE_ANALYSES).doc();
    const storedKeys: string[] = [];
    let recordStored = false;
    try {
      const currency = await lockProjectCurrency(actor.projectId);
      progress("references");
      const references = await loadReferenceInputs(actor, referenceIds);
      const pastDocuments = await Promise.all([...new Set(pastQuoteIds)].slice(0, 5).map((id) => firestore.collection(QUOTE_ANALYSES).doc(id).get()));
      if (pastDocuments.some((document) => !document.exists || document.data()?.projectId !== actor.projectId)) throw new Error("past_quote_not_found");
      const pastQuotes = (await Promise.all(pastDocuments.map((document) => loadStoredQuoteInputs(document.data())))).flat();
      progress("storing");
      const storedFiles: Array<{ fileName: string; contentType: string; size: number; objectKey: string; supplier: string }> = [];
      for (const [index, upload] of uploads.entries()) {
        const safeName = upload.file.name.replace(/[^a-zA-Z0-9._-]/g, "-");
        const objectKey = `${projectStoragePrefix(actor.projectId)}/quotes/${ref.id}-${index}-${safeName}`;
        await bucket.file(objectKey).save(upload.bytes, { contentType: upload.contentType, resumable: false, metadata: { metadata: { uploadedBy: actor.email, originalName: upload.file.name } } });
        storedKeys.push(objectKey);
        storedFiles.push({ fileName: upload.file.name, contentType: upload.contentType, size: upload.file.size, objectKey, supplier: supplierByFile.get(index)! });
      }
      const first = storedFiles[0];
      await ref.set({ title: form.has("offers") ? offers.map((offer) => offer.supplier).join(" vs ") : files[0].name, projectId: actor.projectId, currency, files: storedFiles, objectKey: first.objectKey, fileName: first.fileName, contentType: first.contentType, size: storedFiles.reduce((sum, item) => sum + item.size, 0), uploadedBy: actor.email, referenceIds: references.map((item) => item.id), referenceNames: references.map((item) => item.name), pastQuoteIds: pastDocuments.map((document) => document.id), pastQuoteNames: pastDocuments.map((document) => storedQuoteLabel(document.data())), webRequested: useWeb, status: "analyzing", createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
      recordStored = true;
      progress("budget");
      const budgetContext = await quoteBudgetContext(actor.projectId, actor.role === "admin" || actor.permissions.budget);
      if (actor.role === "admin" || actor.permissions.budget) {
        // Context is deliberately bounded and can end inside its large lines array.
        const contextCurrency = /^\s*\{\s*"currency"\s*:\s*"(USD|CRC)"/.exec(budgetContext)?.[1];
        if (!contextCurrency || projectCurrency(contextCurrency) !== currency) throw new Error("project_currency_changed");
      }
      const quoteFiles: QuoteInputFile[] = storedFiles.map((stored, index) => ({ name: stored.fileName, supplier: stored.supplier, contentType: stored.contentType, objectKey: stored.objectKey, ...(stored.contentType.includes("wordprocessingml") ? { bytes: uploads[index].bytes } : {}) }));
      const analysis = await analyzeQuote({ language, quoteFiles, references, pastQuotes, budgetContext, useWeb, onProgress: progress });
      progress("saving");
      await ref.set({ status: "ready", analysis, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      await completedUsageAction(actor, "quote.analyze", "quotes", ref.id);
      progress("complete");
      return publicQuote(await ref.get());
    } catch (error) {
      console.error("Quote analysis failed", error);
      if (recordStored) await ref.set({ status: "failed", error: "The analysis could not be completed. Try again with a smaller or clearer file.", updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      else await Promise.all(storedKeys.map((objectKey) => bucket.file(objectKey).delete({ ignoreNotFound: true }).catch(() => undefined)));
      throw error;
    }
  };

  if (form.get("stream") === "true") {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (event: object) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        try {
          const quote = await run((stage) => send({ type: "progress", stage }));
          send({ type: "complete", quote });
        } catch {
          send({ type: "error", error: "The analysis could not be completed. Try again with a smaller or clearer file." });
        } finally { controller.close(); }
      },
    });
    return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
  }
  try { return NextResponse.json({ quote: await run() }, { status: 201 }); }
  catch { return NextResponse.json({ error: "The analysis could not be completed. Try again with a smaller or clearer file." }, { status: 502 }); }
}

export async function DELETE(request: Request) {
  const actor = await requireTabAccess("quotes", ["admin", "editor"]);
  if (!actor) return NextResponse.json({ error: "Quotes editor access required" }, { status: 403 });
  const id = new URL(request.url).searchParams.get("id") || "";
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id)) return NextResponse.json({ error: "A quote is required" }, { status: 400 });

  const ref = firestore.collection(QUOTE_ANALYSES).doc(id);
  const document = await ref.get();
  const data = document.data();
  if (!document.exists || data?.projectId !== actor.projectId) return NextResponse.json({ error: "Quote not found" }, { status: 404 });
  if (data?.status === "analyzing") return NextResponse.json({ error: "Wait for the analysis to finish before deleting this quote" }, { status: 409 });

  await firestore.recursiveDelete(ref);
  const quotePrefix = `${projectStoragePrefix(actor.projectId)}/quotes/`;
  const objectKeys = storedQuoteFiles(data).map((file) => file.objectKey).filter((objectKey) => objectKey.startsWith(quotePrefix));
  if (projectBucket) {
    const bucket = projectBucket;
    await Promise.all(objectKeys.map((objectKey) => bucket.file(objectKey).delete({ ignoreNotFound: true }).catch((error) => console.error("Deleted quote file cleanup failed", error))));
  }
  await completedUsageAction(actor, "record.delete", "quotes", id);
  return NextResponse.json({ ok: true });
}
