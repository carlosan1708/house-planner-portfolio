import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createUploadBatch, uploadFormData, type UploadProgressState } from "@/lib/upload-progress";

class FakeRequest {
  static requests: FakeRequest[] = [];
  upload: { onprogress?: (event: { loaded: number; total: number; lengthComputable: boolean }) => void; onload?: () => void } = {};
  onload?: () => void;
  onerror?: () => void;
  onabort?: () => void;
  ontimeout?: () => void;
  onprogress?: () => void;
  onreadystatechange?: () => void;
  readyState = 4;
  status = 200;
  statusText = "OK";
  response: Blob | string = new Blob(['{"ok":true}']);
  responseText = "";
  responseType = "";
  open = vi.fn();
  send = vi.fn();
  setRequestHeader = vi.fn();
  getAllResponseHeaders = () => "content-type: application/json\r\nx-request-id: upload-1\r\n";
  abort = vi.fn(() => this.onabort?.());
  constructor() { FakeRequest.requests.push(this); }
}

beforeEach(() => { FakeRequest.requests = []; vi.stubGlobal("XMLHttpRequest", FakeRequest); });
afterEach(() => vi.unstubAllGlobals());

describe("multipart upload progress", () => {
  it("reports measured transfer progress and keeps the request pending during server processing", async () => {
    const updates: UploadProgressState[] = [];
    let resolved = false;
    const promise = uploadFormData("/api/documents", new FormData(), { onProgress: (state) => updates.push(state) });
    void promise.then(() => { resolved = true; });
    const request = FakeRequest.requests[0];
    expect(request.open).toHaveBeenCalledWith("POST", "/api/documents", true);
    expect(updates.at(-1)).toMatchObject({ phase: "uploading", percent: null });
    request.upload.onprogress?.({ loaded: 400, total: 1000, lengthComputable: true });
    expect(updates.at(-1)).toMatchObject({ phase: "uploading", percent: 40, loadedBytes: 400, totalBytes: 1000 });
    request.upload.onload?.();
    await Promise.resolve();
    expect(updates.at(-1)).toMatchObject({ phase: "processing", percent: 100 });
    expect(resolved).toBe(false);
    request.onload?.();
    const response = await promise;
    expect(response.ok).toBe(true);
    expect(response.headers.get("x-request-id")).toBe("upload-1");
    expect(await response.json()).toEqual({ ok: true });
  });

  it("uses indeterminate progress when browser upload totals are unavailable", async () => {
    const onProgress = vi.fn();
    const promise = uploadFormData("/api/documents", new FormData(), { onProgress });
    const request = FakeRequest.requests[0];
    request.upload.onprogress?.({ loaded: 512, total: 0, lengthComputable: false });
    expect(onProgress).toHaveBeenLastCalledWith({ phase: "uploading", percent: null, loadedBytes: 512, totalBytes: null });
    request.upload.onload?.();
    expect(onProgress).toHaveBeenLastCalledWith({ phase: "processing", percent: null, loadedBytes: 512, totalBytes: null });
    request.onload?.();
    await promise;
  });

  it("preserves server failure status and body for existing response handlers", async () => {
    const promise = uploadFormData("/api/documents", new FormData(), { onProgress: vi.fn() });
    const request = FakeRequest.requests[0];
    request.status = 413;
    request.statusText = "Content Too Large";
    request.response = new Blob(['{"error":"File exceeds the size limit"}']);
    request.onload?.();
    const response = await promise;
    expect(response.ok).toBe(false);
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "File exceeds the size limit" });
  });

  it("rejects connection failures and aborts the browser request when signaled", async () => {
    const failed = uploadFormData("/api/documents", new FormData(), { onProgress: vi.fn() });
    FakeRequest.requests[0].onerror?.();
    await expect(failed).rejects.toThrow("could not reach the server");
    const controller = new AbortController();
    const aborted = uploadFormData("/api/documents", new FormData(), { onProgress: vi.fn(), signal: controller.signal });
    controller.abort();
    await expect(aborted).rejects.toMatchObject({ name: "AbortError" });
    expect(FakeRequest.requests[1].abort).toHaveBeenCalledTimes(1);
    const alreadyAborted = uploadFormData("/api/documents", new FormData(), { onProgress: vi.fn(), signal: controller.signal });
    await expect(alreadyAborted).rejects.toMatchObject({ name: "AbortError" });
    expect(FakeRequest.requests).toHaveLength(2);
  });

  it("allows empty success responses and forwards explicit request headers", async () => {
    const promise = uploadFormData("/api/documents", new FormData(), { onProgress: vi.fn(), method: "PUT", headers: { "X-Upload-Id": "one" } });
    const request = FakeRequest.requests[0];
    request.status = 204;
    request.statusText = "No Content";
    request.onload?.();
    expect(request.setRequestHeader).toHaveBeenCalledWith("x-upload-id", "one");
    expect((await promise).body).toBeNull();
  });

  it("delivers streamed analysis stages as they arrive without replaying prior chunks", async () => {
    const chunks: string[] = [];
    const stages: string[] = [];
    let buffer = "";
    const promise = uploadFormData("/api/quotes", new FormData(), {
      onProgress: vi.fn(),
      onResponseText: (chunk, metadata) => {
        expect(metadata.ok).toBe(true);
        chunks.push(chunk);
        buffer += chunk;
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        lines.filter(Boolean).forEach((line) => stages.push(JSON.parse(line).stage));
      },
    });
    const request = FakeRequest.requests[0];
    expect(request.responseType).toBe("text");
    request.readyState = 3;
    request.responseText = '{"stage":"reading"}\n{"stage":';
    request.onreadystatechange?.();
    expect(stages).toEqual(["reading"]);
    request.onprogress?.();
    expect(chunks).toHaveLength(1);
    request.responseText += '"comparing"}\n';
    request.onprogress?.();
    expect(stages).toEqual(["reading", "comparing"]);
    request.responseText += '{"stage":"complete"}\n';
    request.response = request.responseText;
    request.readyState = 4;
    request.onload?.();
    const response = await promise;
    expect(stages).toEqual(["reading", "comparing", "complete"]);
    expect(await response.text()).toBe(request.responseText);
  });

  it("rejects malformed streamed data and stops the browser request", async () => {
    const promise = uploadFormData("/api/quotes", new FormData(), { onProgress: vi.fn(), onResponseText: () => { throw new Error("Malformed analysis event"); } });
    const request = FakeRequest.requests[0];
    request.readyState = 3;
    request.responseText = "not JSON\n";
    request.onprogress?.();
    await expect(promise).rejects.toThrow("Malformed analysis event");
    expect(request.abort).toHaveBeenCalledTimes(1);
  });
});

describe("sequential upload batches", () => {
  it("weights progress by bytes and counts files only after successful server responses", () => {
    const updates: UploadProgressState[] = [];
    const batch = createUploadBatch([{ name: "small.pdf", size: 1000 }, { name: "large.pdf", size: 9000 }], (state) => updates.push(state));
    const first = batch.track(0);
    first({ phase: "processing", percent: 100, loadedBytes: 1100, totalBytes: 1100 });
    expect(updates.at(-1)).toMatchObject({ percent: 10, completedFiles: 0, fileName: "small.pdf", fileCount: 2 });
    batch.complete(0);
    expect(updates.at(-1)).toMatchObject({ percent: 10, completedFiles: 1 });
    const second = batch.track(1);
    second({ phase: "uploading", percent: 50, loadedBytes: 4500, totalBytes: 9000 });
    expect(updates.at(-1)).toMatchObject({ percent: 55, loadedBytes: 5500, totalBytes: 10000, fileIndex: 2, completedFiles: 1 });
    second({ phase: "processing", percent: 100, loadedBytes: 9000, totalBytes: 9000 });
    expect(updates.at(-1)).toMatchObject({ percent: 100, phase: "processing", completedFiles: 1 });
    batch.complete(1);
    expect(updates.at(-1)).toMatchObject({ percent: 100, completedFiles: 2 });
  });

  it("does not invent a fraction for unknown upload lengths or zero-byte batches", () => {
    const onProgress = vi.fn();
    const batch = createUploadBatch([{ name: "file.pdf", size: 1000 }], onProgress);
    batch.track(0)({ phase: "uploading", percent: null, loadedBytes: 128, totalBytes: null });
    expect(onProgress.mock.lastCall?.[0]).toMatchObject({ percent: null, loadedBytes: 0 });
    createUploadBatch([{ name: "empty.txt", size: 0 }], onProgress).track(0);
    expect(onProgress.mock.lastCall?.[0]).toMatchObject({ percent: null, totalBytes: 0 });
  });
});
