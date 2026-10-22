export class UnexpectedApiResponseError extends Error {
  status: number;

  constructor(status: number) {
    super("Unexpected API response");
    this.name = "UnexpectedApiResponseError";
    this.status = status;
  }
}

const isJson = (response: Response) => response.headers.get("content-type")?.toLowerCase().includes("application/json") === true;
const isTransientStatus = (status: number) => status === 429 || status === 502 || status === 503 || status === 504;

export async function readJsonResponse<T = Record<string, unknown>>(response: Response): Promise<T> {
  const text = await response.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new UnexpectedApiResponseError(response.status);
  }

  if (!response.ok) {
    const message = typeof data === "object" && data && "error" in data && typeof data.error === "string"
      ? data.error
      : "Request failed";
    throw new Error(message);
  }
  return data as T;
}

export async function requestWithRetry(request: () => Promise<Response>, retries = 0, retryDelayMs = 750, expected = (response: Response) => response.ok): Promise<Response> {
  let response = await request();
  for (let attempt = 0; attempt < retries; attempt += 1) {
    if (!isTransientStatus(response.status) && (!response.ok || expected(response))) break;
    if (retryDelayMs > 0) await new Promise((resolve) => globalThis.setTimeout(resolve, retryDelayMs * (attempt + 1)));
    response = await request();
  }
  return response;
}

export async function requestJsonWithRetry<T = Record<string, unknown>>(request: () => Promise<Response>, retries = 0, retryDelayMs = 750): Promise<T> {
  const response = await requestWithRetry(request, retries, retryDelayMs, (candidate) => candidate.ok && isJson(candidate));
  return readJsonResponse<T>(response);
}
