export type UploadProgressState = {
  phase: "uploading" | "processing";
  percent: number | null;
  loadedBytes: number;
  totalBytes: number | null;
  fileName?: string;
  fileIndex?: number;
  fileCount?: number;
  completedFiles?: number;
};

type UploadOptions = {
  onProgress: (progress: UploadProgressState) => void;
  method?: string;
  headers?: HeadersInit;
  signal?: AbortSignal;
  onResponseText?: (chunk: string, response: Pick<Response, "ok" | "status" | "headers">) => void;
};

/** Sends multipart data with browser-reported transfer progress. HTTP failures
 * stay Responses so callers retain their existing API error handling. */
export function uploadFormData(url: string, body: FormData, { onProgress, method = "POST", headers, signal, onResponseText }: UploadOptions): Promise<Response> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("The upload was aborted", "AbortError"));
      return;
    }
    const request = new XMLHttpRequest();
    let loadedBytes = 0;
    let totalBytes: number | null = null;
    let processing = false;
    let settled = false;
    let responseOffset = 0;
    const notify = () => onProgress({
      phase: processing ? "processing" : "uploading",
      loadedBytes,
      totalBytes,
      percent: totalBytes === null ? null : Math.min(100, Math.floor(loadedBytes / totalBytes * 100)),
    });
    const abort = () => request.abort();
    const cleanup = () => signal?.removeEventListener("abort", abort);
    const fail = (reason: unknown) => { if (!settled) { settled = true; cleanup(); reject(reason); } };
    const responseHeaders = () => {
      const result = new Headers();
      request.getAllResponseHeaders().trim().split(/[\r\n]+/).forEach((line) => {
        const colon = line.indexOf(":");
        if (colon > 0) result.append(line.slice(0, colon).trim(), line.slice(colon + 1).trim());
      });
      return result;
    };
    const deliverResponseText = () => {
      if (!onResponseText || settled || request.readyState < 3 || !request.status) return;
      const text = request.responseText;
      const chunk = text.slice(responseOffset);
      responseOffset = text.length;
      if (!chunk) return;
      try { onResponseText(chunk, { status: request.status, ok: request.status >= 200 && request.status < 300, headers: responseHeaders() }); }
      catch (reason) { fail(reason); request.abort(); }
    };
    request.open(method, url, true);
    request.responseType = onResponseText ? "text" : "blob";
    new Headers(headers).forEach((value, key) => request.setRequestHeader(key, value));
    request.upload.onprogress = (event) => {
      loadedBytes = Math.max(loadedBytes, event.loaded);
      totalBytes = event.lengthComputable && event.total > 0 ? event.total : null;
      notify();
    };
    request.upload.onload = () => {
      processing = true;
      if (totalBytes !== null) loadedBytes = totalBytes;
      notify();
    };
    if (onResponseText) {
      request.onreadystatechange = deliverResponseText;
      request.onprogress = deliverResponseText;
    }
    request.onload = () => {
      deliverResponseText();
      if (settled) return;
      if (!request.status) { fail(new TypeError("The upload could not reach the server")); return; }
      // These HTTP statuses must not have a body in a native Response.
      const responseBody = [204, 205, 304].includes(request.status) ? null : request.response as Blob | string;
      try {
        const response = new Response(responseBody, { status: request.status, statusText: request.statusText, headers: responseHeaders() });
        settled = true;
        cleanup();
        resolve(response);
      } catch (reason) { fail(reason); }
    };
    request.onerror = () => fail(new TypeError("The upload could not reach the server"));
    request.onabort = () => fail(new DOMException("The upload was aborted", "AbortError"));
    request.ontimeout = () => fail(new TypeError("The upload timed out"));
    signal?.addEventListener("abort", abort, { once: true });
    notify();
    try { request.send(body); } catch (reason) { fail(reason); }
  });
}

/** Weighs a sequential upload batch by file bytes rather than file count.
 * complete() is called only after the server has accepted that file. */
export function createUploadBatch(files: readonly Pick<File, "name" | "size">[], onProgress: (progress: UploadProgressState) => void) {
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  const completed = new Set<number>();
  const fractions = files.map(() => 0);
  const publish = (index: number, phase: UploadProgressState["phase"], measurable: boolean) => {
    const loadedBytes = files.reduce((sum, file, position) => sum + file.size * fractions[position], 0);
    onProgress({
      phase,
      loadedBytes,
      totalBytes,
      percent: measurable && totalBytes > 0 ? Math.min(100, Math.floor(loadedBytes / totalBytes * 100)) : null,
      fileName: files[index]?.name,
      fileIndex: index + 1,
      fileCount: files.length,
      completedFiles: completed.size,
    });
  };
  return {
    track(index: number) {
      publish(index, "uploading", true);
      return (progress: UploadProgressState) => {
        if (progress.phase === "processing") fractions[index] = 1;
        else if (progress.totalBytes && progress.percent !== null) fractions[index] = Math.max(fractions[index], Math.min(1, progress.loadedBytes / progress.totalBytes));
        publish(index, progress.phase, progress.percent !== null || progress.phase === "processing");
      };
    },
    complete(index: number) {
      fractions[index] = 1;
      completed.add(index);
      publish(index, "processing", true);
    },
  };
}
