import { describe, expect, it } from "vitest";
import {
  canCreateMobileCapture,
  captureContentType,
  captureFileExtension,
  mobileCaptureTargetTab,
  normalizeCaptureAttachments,
  normalizeMobileCaptureId,
  normalizeMobileCaptureNote,
  normalizeMobileCaptureTarget,
} from "@/lib/mobile-capture";

const permissions = { overview: true, activity: true, budget: true, quotes: true, expenses: true, documents: true, notes: false, aesthetics: true, distribution: true, approvals: true, plan: true, decisions: true, site: true };

describe("mobile field capture", () => {
  it("normalizes ids, destinations, notes, and codec-qualified content types", () => {
    expect(normalizeMobileCaptureId("018f47b4-2c44-7ef0-a86f-6f05f24cd310")).toBe("018f47b4-2c44-7ef0-a86f-6f05f24cd310");
    expect(normalizeMobileCaptureId("short")).toBe("");
    expect(normalizeMobileCaptureTarget("site_issue")).toBe("site_issue");
    expect(normalizeMobileCaptureTarget("project")).toBeNull();
    expect(normalizeMobileCaptureNote("  avance\n\t norte  ")).toBe("avance norte");
    expect(captureContentType("audio/webm;codecs=opus")).toBe("audio/webm");
    expect(captureFileExtension("audio/mp4")).toBe("m4a");
    expect(mobileCaptureTargetTab("decision")).toBe("decisions");
  });

  it("requires a shared editable project and destination access", () => {
    const admin = { role: "admin" as const, permissions, isPersonal: false };
    const editor = { role: "editor" as const, permissions, isPersonal: false };
    expect(canCreateMobileCapture(admin, "expense")).toBe(true);
    expect(canCreateMobileCapture({ ...admin, permissions: { ...permissions, documents: false } }, "expense")).toBe(true);
    expect(canCreateMobileCapture(editor, "expense")).toBe(false);
    expect(canCreateMobileCapture(editor, "site_issue")).toBe(true);
    expect(canCreateMobileCapture({ ...editor, permissions: { ...permissions, documents: false } }, "decision")).toBe(false);
    expect(canCreateMobileCapture({ ...admin, isPersonal: true }, "site_issue")).toBe(false);
    expect(canCreateMobileCapture({ ...admin, role: "viewer" }, "site_issue")).toBe(false);
  });

  it("sanitizes persisted attachment metadata", () => {
    expect(normalizeCaptureAttachments([{ captureId: "018f47b4-2c44-7ef0-a86f-6f05f24cd310", documentId: "photo-1", folderId: "folder-1", fileName: "factura.jpg", contentType: "image/jpeg", note: "  frente\n norte " }])).toEqual([{
      captureId: "018f47b4-2c44-7ef0-a86f-6f05f24cd310",
      documentId: "photo-1",
      folderId: "folder-1",
      fileName: "factura.jpg",
      contentType: "image/jpeg",
      note: "frente norte",
    }]);
    expect(normalizeCaptureAttachments([{ captureId: "bad", documentId: "x", fileName: "x" }])).toEqual([]);
  });
});
