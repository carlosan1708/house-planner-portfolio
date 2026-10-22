import { expect, it, vi } from "vitest";

vi.mock("@/lib/firebase-admin", () => ({ firestore: {}, projectBucket: null }));

import { isQuoteReferenceEnabled, storedQuoteFiles, storedQuoteLabel } from "@/lib/quote-context";

it("reads every document in a quote package", () => {
  const files = storedQuoteFiles({ files: [
    { fileName: "offer.pdf", contentType: "application/pdf", objectKey: "quotes/offer.pdf", size: 120 },
    { fileName: "terms.docx", contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", objectKey: "quotes/terms.docx", size: 80 },
  ] });
  expect(files.map((file) => file.name)).toEqual(["offer.pdf", "terms.docx"]);
  expect(storedQuoteLabel({ files: [
    { fileName: "offer.pdf", contentType: "application/pdf", objectKey: "quotes/offer.pdf", size: 120 },
    { fileName: "terms.docx", contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", objectKey: "quotes/terms.docx", size: 80 },
  ] })).toBe("offer.pdf +1");
});

it("keeps legacy single-document quotes readable", () => {
  expect(storedQuoteFiles({ fileName: "legacy.pdf", contentType: "application/pdf", objectKey: "quotes/legacy.pdf", size: 50 }))
    .toEqual([{ name: "legacy.pdf", contentType: "application/pdf", objectKey: "quotes/legacy.pdf", size: 50 }]);
});

it("requires an explicit document selection before showing it in quote reviews", () => {
  expect(isQuoteReferenceEnabled(undefined)).toBe(false);
  expect(isQuoteReferenceEnabled({})).toBe(false);
  expect(isQuoteReferenceEnabled({ quoteReferenceEnabled: false })).toBe(false);
  expect(isQuoteReferenceEnabled({ quoteReferenceEnabled: true })).toBe(true);
});
