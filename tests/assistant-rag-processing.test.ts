import { Timestamp } from "firebase-admin/firestore";
import JSZip from "jszip";
import sharp from "sharp";
import { beforeEach, expect, it, vi } from "vitest";
import type { RagJob } from "@/lib/rag-jobs";

const state = vi.hoisted(() => ({
  job: null as RagJob | null,
  source: {} as Record<string, unknown>,
  bytes: Buffer.alloc(0) as Buffer,
  chunks: [] as Record<string, unknown>[],
  embeddings: vi.fn(),
  ocr: vi.fn(),
  download: vi.fn(),
}));

vi.mock("google-auth-library", async (load) => ({
  ...await load<typeof import("google-auth-library")>(),
  GoogleAuth: class { request = state.ocr; },
}));
vi.mock("@/lib/gemini", () => ({ geminiClient: () => ({ models: { embedContent: state.embeddings } }) }));
vi.mock("@/lib/folders", async (load) => ({
  ...await load<typeof import("@/lib/folders")>(),
  listProjectFolders: async () => [{ id: "vault", name: "Vault", parentId: null, createdAt: "", encrypted: true }],
}));
vi.mock("@/lib/firebase-admin", () => {
  const jobRef = { id: "job", get: async () => ({ data: () => state.job }) };
  function jobQuery(priority?: string) {
    const query = {
      where: (field: string, _operator: string, value: string) => field === "priority" ? jobQuery(value) : query,
      orderBy: () => query, limit: () => query,
      get: async () => ({ docs: state.job?.dueAt && state.job.dueAt.toMillis() <= Date.now() && state.job.priority === priority ? [{ ref: jobRef }] : [] }),
    };
    return query;
  }
  const ragProject = { collection: (name: string) => name === "assistantRagChunks"
    ? { doc: (id: string) => ({ id }), where: () => ({ limit: () => ({ get: async () => ({ size: 0, docs: [] }) }) }) }
    : jobQuery() };
  const firestore = {
    collection: (name: string) => ({ doc: () => name === "housePlannerAssistantRag" ? ragProject : { get: async () => ({ data: () => state.source }) } }),
    runTransaction: async (callback: (transaction: object) => unknown) => callback({
      get: (ref: { get: () => Promise<unknown> }) => ref.get(),
      update: (_ref: unknown, changes: Record<string, unknown>) => {
        for (const [key, value] of Object.entries(changes)) {
          if (value?.constructor?.name === "DeleteTransform") delete (state.job as unknown as Record<string, unknown>)[key];
          else (state.job as unknown as Record<string, unknown>)[key] = value;
        }
      },
      set: (_ref: unknown, chunk: Record<string, unknown>) => state.chunks.push(chunk),
      delete: () => { state.job = null; },
    }),
  };
  return { firestore, projectBucket: { file: () => ({
    getMetadata: async () => [{ generation: "123", size: state.bytes.length }],
    download: state.download,
  }) } };
});

import { processRagProject } from "@/lib/rag-processing";
import { withPlanFile } from "@/lib/assistant-image-model";

function setup(name: string, contentType: string, bytes: Buffer) {
  state.bytes = bytes;
  state.source = { projectId: "alpha", fileName: name, contentType, objectKey: `house-planner/projects/alpha/documents/${name}` };
}

function samplePdf(pageCount: number, digital = false) {
  const content = digital ? "BT /F1 10 Tf 10 50 Td (Construction receipt total CRC 6,200,000 and installation scope) Tj ET" : "0 0 0 rg 35 50 120 10 re f";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${Array.from({ length: pageCount }, (_, page) => `${page + 4} 0 R`).join(" ")}] /Count ${pageCount} >>`,
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    ...Array.from({ length: pageCount }, () => "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 100] /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> /Contents 3 0 R >>"),
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = objects.map((object, index) => {
    const offset = pdf.length;
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  return Buffer.from(`${pdf}xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${pdf.length}\n%%EOF\n`);
}

const tick = () => processRagProject("alpha", Date.now() + 15_000);

it("renders the selected page of a synthetic plan as an image reference", async () => {
  setup("plan.pdf", "application/pdf", samplePdf(5));
  await withPlanFile({ objectKey: "synthetic.pdf", format: "pdf" }, async file => {
    expect(file.pageCount).toBe(5);
    const reference = await file.render(5, 600);
    expect(reference.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
  });
});

beforeEach(() => {
  vi.resetAllMocks();
  state.job = {
    projectId: "alpha", key: { kind: "document", id: "item", index: 0 }, version: "first",
    status: "pending", priority: "upload", page: 1, offset: 0, attempts: 0, chunkCount: 0, dueAt: Timestamp.now(),
  };
  state.chunks = [];
  state.download.mockImplementation(async () => [state.bytes]);
  state.embeddings.mockResolvedValue({ embeddings: [{ values: Array.from({ length: 768 }, () => 0.1) }] });
  state.ocr.mockResolvedValue({ data: { responses: [{ fullTextAnnotation: { text: "Factura fotografiada. Total 125 000 colones." } }] } });
});

it("indexes a digital PDF and retains its page without OCR", async () => {
  setup("factura.pdf", "application/pdf", samplePdf(1, true));
  await tick();
  expect(state.job?.status).toBe("ready");
  expect(state.chunks).toHaveLength(1);
  expect(state.chunks[0]).toMatchObject({ page: 1, text: expect.stringContaining("6,200,000") });
  expect(state.ocr).not.toHaveBeenCalled();
});

it("resumes a scanned PDF by page and only publishes when complete", async () => {
  setup("escaneo.pdf", "application/pdf", samplePdf(2));
  await tick();
  expect(state.job).toMatchObject({ page: 2, status: "indexing" });
  await tick();
  expect(state.job?.status).toBe("ready");
  expect(state.chunks.map((chunk) => chunk.page)).toEqual([1, 2]);
  expect(state.ocr).toHaveBeenCalledTimes(2);
});

it("extracts DOCX and OCRs a photographed receipt", async () => {
  const zip = new JSZip();
  zip.file("_rels/.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file("word/document.xml", '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Contrato de instalación eléctrica</w:t></w:r></w:p></w:body></w:document>');
  setup("contrato.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", await zip.generateAsync({ type: "nodebuffer" }));
  const initial = { ...state.job! };
  await tick();
  expect(state.chunks[0]).toMatchObject({ page: null, text: "Contrato de instalación eléctrica" });
  state.job = initial;
  setup("receipt.jpg", "image/jpeg", await sharp({ create: { width: 30, height: 30, channels: 3, background: "#fff" } }).jpeg().toBuffer());
  await tick();
  expect(state.chunks[1]).toMatchObject({ page: null, text: expect.stringContaining("125 000 colones") });
});

it("retries a transient embedding error and discards output from a stale worker", async () => {
  setup("factura.pdf", "application/pdf", samplePdf(1, true));
  state.embeddings.mockRejectedValueOnce(new Error("transient"));
  await tick();
  expect(state.job).toMatchObject({ status: "pending", attempts: 1 });
  expect(state.chunks).toEqual([]);
  state.job!.dueAt = Timestamp.now();
  await tick();
  expect(state.job?.status).toBe("ready");
  state.chunks = [];
  state.job = { ...state.job!, version: "next", status: "pending", dueAt: Timestamp.now(), page: 1, chunkCount: 0 };
  state.embeddings.mockImplementationOnce(async () => {
    state.source.encrypted = true;
    state.job = { ...state.job!, version: "purge", cleanup: true, purge: true };
    return { embeddings: [{ values: Array.from({ length: 768 }, () => 0.1) }] };
  });
  await tick();
  expect(state.chunks).toEqual([]);
  expect(state.job).toMatchObject({ version: "purge", purge: true });
});
