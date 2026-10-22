# Implementation Plan: Featured documents

> Historical private-development record. Its commit IDs are metadata only; the original commit objects and review evidence are retained privately and are not part of this public snapshot. See [snapshot provenance](../../docs/portfolio/snapshot.md).

**Branch**: `codex/featured-documents` | **Date**: 2026-10-13 | **Spec**: [spec.md](spec.md)

**Status**: Design prepared before implementation. Initial specification commit: `14df06a8b09b44c4bf7e318c48cdeb477951159d`. Operational main baseline: `d803cc45d55e836a9cd4ebf81c3e900132788e16`.

## Summary

Make Featured documents the Documents root default, retain folders, and expose Unfiled separately. Persist ordered project references through a dedicated authorized route. A reusable hook/picker handles search, full paths, draft state and incremental saving. Reuse document rows, previews and downloads.

## Technical Context

- TypeScript 5, Next.js 16.3.1, React 19.2.8 from the current manifest; existing Firebase Admin/Firestore, no new package/service.
- Existing per-project CONFIG from `projectConfigDoc(projectId)` stores `featuredDocumentIds`; feature writes merge without overwriting unrelated configuration.
- Vitest helper/route/component tests, local Playwright, full lint/test/build/docs, exact-source CI and manual synthetic desktop/mobile review.
- At most 30 valid globally stored references including ordinary documents hidden by caller grants. No file migration, encrypted plaintext retrieval, private text translation or remote demo persistence. No new performance benchmark is claimed.
- Installed Next route-handler documentation reviewed during planning; each implementer must read relevant installed server/client guides before code, as AGENTS.md requires.

## Constitution Check

[Constitution 1.0.3](../../.specify/memory/constitution.md) checked before research and after design:

1. Current identity, active membership, Documents/role and folder authorization remain server-enforced; Overview is independent.
2. Same-project ownership and local-only demo preserve isolation; all fixtures/manual evidence use synthetic records.
3. Encrypted documents/ancestry are excluded even unlocked; no AI retrieval or model claims are added.
4. Boundary/race tests and exact-source verification remain required. This server change is outside the presentation-only release exception; separately authorized release retains ordinary isolated cloud QA/backup/provenance gates.
5. Specification precedes design/tasks/analysis/code. Real commits/results are recorded later; completed 001-003 remain unchanged.

No exception/amendment requested. QA controls remain USD 5.50 target / USD 5.25 cutoff / maximum 10 candidate builds. No spend/deployment is authorized here.

## Decisions

1. **Route**: `app/api/documents/featured/route.ts`: GET `{documentIds:string[]}` and PATCH `{addIds:string[],removeIds:string[]}`. Documents permissions alone suffice; private/no-store replies. [Contract](contracts/featured-documents.md).
2. **Transaction**: Validate/deduplicate bounded submitted IDs and reject overlap. Validate all submitted targets, including removals, before writing. Read latest CONFIG and target/folder state within the transaction; preserve unrelated settings and current ordered valid ordinary selections hidden by grants. Apply authorized removals and append additions in input order. Enforce the 30 global cap atomically.
3. **Metadata hygiene**: GET only filters; it never cleans storage. An otherwise accepted transaction removes stored references proven structurally unavailable (missing/deleted/foreign/encrypted/reserved/orphaned) before counting. Invalid submitted IDs reject the whole request before cleanup. Valid ordinary references hidden only by grants remain. This engineering consistency default avoids a permanently full unusable collection; it is not a literal author statement or file deletion/move.
4. **Eligibility**: Current same-project non-deleted documents, effective Documents/folder grants, valid ancestry, no encrypted document/ancestor, no Factura/Compras reserved root ancestry. Return only visible IDs in stored order; no raw hidden IDs/content or vault unlock.
5. **Pure helper**: `lib/featured-documents.ts` owns types, input/ID parsing, stable deduplication and ordered delta; no Firestore/auth/browser dependencies. Server authorization stays in the route.
6. **Client**: `app/components/FeaturedDocumentsSelection.tsx` exports reusable hook/native application picker; `featured-documents.css` owns responsive styles. Search current authorized candidates with full folder paths. Separate opening visible baseline, draft and saved selection; send additions/removals only, never replacement. Cancel/failure retain saved state; failure retains draft/error for retry.
7. **Integration**: Root owns `app/HousePlanner.tsx` and demo IDs across navigation/language/remounts. Root distinguishes Featured/Unfiled, reuses rows/search/preview/download, intersects featured IDs with current eligible records, and disables Featured handlers that would move files into Unfiled. Explicit Unfiled/folders retain original operations. Real reads refresh on root mount/project changes and discard obsolete responses. Demo makes zero featured API calls.
8. **Release boundary**: Do not extend the presentation-only allowlist to this route or reuse earlier QA as server evidence. Local/CI completion is separate from any authorized deployment.

## Project Structure and Ownership

```text
specs/004-featured-documents/
  spec.md, plan.md, research.md, data-model.md, quickstart.md
  contracts/featured-documents.md, checklists/requirements.md
  tasks.md, analysis.md, traceability.md, traceability.json
  validation.md, convergence.md
lib/featured-documents.ts
app/api/documents/featured/route.ts
app/components/FeaturedDocumentsSelection.tsx
app/components/featured-documents.css
app/HousePlanner.tsx
tests/featured-documents.test.ts
tests/featured-documents-route.test.ts
tests/featured-documents-selection.test.tsx
e2e/featured-documents.spec.ts
```

New source paths are planned, not already implemented. Backend owns helper/route/backend tests; component agent owns picker/styles/component tests; root owns HousePlanner/browser integration and final checks. Establish shared types first, then backend and component work in separate files. See [research](research.md), [data model](data-model.md), [quickstart](quickstart.md), and [tasks](tasks.md).

## Implementation Checkpoint 2026-10-14

The planned source/test files now exist. Initial spec `14df06a8b09b44c4bf7e318c48cdeb477951159d`, plan `7d6a5034765ce1761e85b7f6acc17a00500c91fa`, original tasks/analysis `941acb1f23db3a9534b5e385dcbe2dc379716e47`, and additional visible-baseline/read-only clarification `d127ca94991d88ee89e2894a882774ecf4290e37` precede the implementation commits. The initial measured checkpoint `34088995f1a151622212be0a0a7047c10bc1a797` and later accepted application source `19afb20ea081d28b1ed1e157467fe967aac2b028` are recorded in [validation](validation.md), including exact-source CI and manual scope/limits.

## Separate Policy Amendment 2026-10-14

The constitution check and release decision above record the 2026-10-13 preimplementation policy; they are not current instructions to require cloud QA. The author has explicitly superseded that classification: cloud QA is optional for every change, requires approval for each run, and is offered only for substantial need or the author's request. [005](../005-optional-cloud-qa/spec.md) implements that operational amendment separately. Feature004 application development is accepted at its identified source; later policy code and production release require their own source-specific evidence. Backup, authorization, provenance and cost limits continue to apply.
