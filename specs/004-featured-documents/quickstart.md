# Local Validation Guide

> Historical private-development record. Its commit IDs are metadata only; the original commit objects and review evidence are retained privately and are not part of this public snapshot. See [snapshot provenance](../../docs/portfolio/snapshot.md).

**Status**: Runnable local guide. Completed checks and remaining work are recorded in [validation](validation.md).

## Prerequisites and Commands

Use existing dependency setup, installed Next guides, synthetic data and localhost/emulators only. Routine Playwright rejects nonlocal origins. The tracked feature tests now exist; run commands on a source whose actual results can be recorded.

```powershell
npm run test -- tests/featured-documents.test.ts tests/featured-documents-route.test.ts tests/featured-documents-selection.test.tsx
npm run lint
npm run test
npm run build
npm run docs:check
npm run test:e2e -- e2e/featured-documents.spec.ts --project=chromium
npm run qa:local -- --suite=permissions
```

Existing Playwright config supplies local demo/mock environment. Private behavior uses mocked server dependencies or synthetic local emulator fixtures, never production records. The isolated local permissions launcher uses real local emulators and synthetic identities with AI disabled; it remains separate from mocked browser evidence, complete CI and manual review.

## Synthetic Acceptance Walkthrough

1. Prepare ordinary sibling/nested folders with repeated names, plain files, Unfiled files, reserved expense descendants, encrypted roots/descendants, missing/deleted/foreign IDs and orphaned ancestry.
2. With Documents access but no Overview permission, open Documents: Featured defaults, folder grid remains, Unfiled is explicit and empty configuration does not auto-select files.
3. As an editor, search full paths, select files across folders and save. Retained order remains, new IDs append in selected order; names/folders/content/grants remain unchanged.
4. Cancel another draft; simulate rejection/persistence failure. Saved selection stays unchanged; failed draft/error remains retryable. A viewer cannot curate.
5. Submit inaccessible/foreign/missing/deleted/reserved/encrypted/unlocked-vault descendant IDs, including removals. Reject atomically without cleanup/disclosure. Revoke a grant after dialog opening and reject save.
6. Mix valid hidden references with structurally unavailable stored references. GET filters without writing. An otherwise accepted PATCH prunes only structurally unavailable references; valid hidden references and unrelated concurrent additions survive. The global 30-valid-reference cap rejects overflow atomically without cleanup writes.
7. Drag a filed document over Featured: it is not moved into Unfiled. Explicit Unfiled/folder upload/drop/move and existing preview/download still work.
8. Demo: save selection, navigate away/back, toggle EN/ES with saved/open draft state, and assert zero featured/private selection API requests. Preserve custom/private text and stored order.
9. Manually review desktop/mobile dialog scroll, full paths, search, errors and controls using synthetic files; record actual observations and private evidence without invented screenshots/timings.

Record source, commands, counts, results and omissions in [validation](validation.md), with genuine requirement links in [traceability](traceability.md). These commands do not deploy or increase the QA allowance.
