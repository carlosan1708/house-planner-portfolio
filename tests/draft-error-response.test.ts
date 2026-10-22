import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(()=>({config:vi.fn()}));
vi.mock("@/lib/auth",()=>({requireTabAccess:async()=>({uid:"owner",projectId:"project",role:"admin"})}));
vi.mock("@/lib/firebase-admin",()=>({firestore:{collection:()=>({doc:()=>({get:async()=>({exists:true,data:()=>({projectId:"project",createdByUid:"owner",status:"editing",snapshotObjectKey:"draft.json",basePlanVersion:1})})})})},projectBucket:{}}));
vi.mock("@/lib/workbook-store",()=>({workbookConfig:mocks.config}));
vi.mock("@/lib/google-budget",()=>({googleSyncMessage:()=>"Google sigue actualizando la hoja. Tu borrador se conserva.",syncAfterBudgetCommit:vi.fn()}));
import { POST } from "@/app/api/workbook/drafts/route";
beforeEach(()=>{mocks.config.mockRejectedValue(new Error("La hoja cambió durante la lectura"));});
it("returns a JSON conflict instead of an empty 500 when synchronization interrupts publishing",async()=>{
 const response=await POST(new Request("http://localhost/api/workbook/drafts",{method:"POST",body:JSON.stringify({action:"publish",id:"draft"})}));
 expect(response.status).toBe(409);
 expect(response.headers.get("content-type")).toContain("application/json");
 expect((await response.json()).error).toContain("borrador se conserva");
});
it("returns JSON for an incomplete incoming request",async()=>{
 const response=await POST(new Request("http://localhost/api/workbook/drafts",{method:"POST",body:'{"action":'}));
 expect(response.status).toBe(400);
 expect((await response.json()).code).toBe("invalid_json");
});
