import { describe, expect, it, vi } from "vitest";
import { readJsonResponse, requestJsonWithRetry, UnexpectedApiResponseError } from "@/lib/api-client";

describe("API JSON responses", () => {
  it("returns a controlled error when an upstream HTML page replaces JSON", async () => {
    const response = new Response("<html><head><title>Bad gateway</title></head></html>", { status: 502, headers: { "Content-Type": "text/html" } });
    await expect(readJsonResponse(response)).rejects.toBeInstanceOf(UnexpectedApiResponseError);
  });

  it("retries an idempotent request once after an HTML response", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(new Response("<html><head></head></html>", { status: 502, headers: { "Content-Type": "text/html" } }))
      .mockResolvedValueOnce(Response.json({ ok: true }));

    await expect(requestJsonWithRetry(request, 1, 0)).resolves.toEqual({ ok: true });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("retries a JSON 429 response because the request was rate limited", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(Response.json({ error: "Rate exceeded" }, { status: 429 }))
      .mockResolvedValueOnce(Response.json({ ok: true }));

    await expect(requestJsonWithRetry(request, 1, 0)).resolves.toEqual({ ok: true });
    expect(request).toHaveBeenCalledTimes(2);
  });
});
