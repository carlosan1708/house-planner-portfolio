import { expect, it, vi } from "vitest";
import type { OAuth2Client } from "google-auth-library";
vi.mock("@/lib/firebase-admin", () => ({ firestore: {} }));
import { readStableGoogleWorkbook } from "@/lib/google-sheets";
import { readApiResponse } from "@/lib/read-api-response";
it("retries changing exports and returns bytes with their matching revision", async () => {
  const request = vi.fn()
    .mockResolvedValueOnce({data:{version:"1",etag:"one"}})
    .mockResolvedValueOnce({data:Buffer.from("unstable")})
    .mockResolvedValueOnce({data:{version:"2",etag:"two"}})
    .mockResolvedValueOnce({data:{version:"2",etag:"two"}})
    .mockResolvedValueOnce({data:Buffer.from("stable")})
    .mockResolvedValueOnce({data:{version:"2",etag:"two"}});
  const result = await readStableGoogleWorkbook({request} as unknown as OAuth2Client,"file");
  expect(result.bytes.toString()).toBe("stable");
  expect(result.state.etag).toBe("two");
});
it("bounds retries and preserves the draft when Google keeps changing", async () => {
  let version = 0;
  const request = vi.fn(async (options:{url:string}) => ({data: options.url.includes('/export?') ? Buffer.from("changing") : {version:String(version++),etag:"revision"}}));
  await expect(readStableGoogleWorkbook({request} as unknown as OAuth2Client,"file")).rejects.toThrow("borrador se conserva");
  expect(request).toHaveBeenCalledTimes(9);
});
it("handles empty or HTML error responses without a JSON parsing error", async () => {
  for (const body of ["", "<html>gateway failure</html>"]) {
    await expect(readApiResponse(new Response(body,{status:502}))).rejects.toThrow("Tus cambios siguen en la pantalla");
  }
  expect(await readApiResponse(Response.json({error:"Retry",code:"conflict"},{status:409}))).toEqual({error:"Retry",code:"conflict"});
});
