# Tasks: Featured documents

> Historical private-development record. Its commit IDs are metadata only; the original commit objects and review evidence are retained privately and are not part of this public snapshot. See [snapshot provenance](../../docs/portfolio/snapshot.md).

**Input**: [spec](spec.md), [plan](plan.md), [research](research.md), [data model](data-model.md), [contract](contracts/featured-documents.md).

Tasks T001-T020 are complete for the feature004 application-development scope. [Validation](validation.md) identifies the exact accepted application source, complete CI and scoped manual results with ancillary limits. Later policy implementation and production release are recorded separately in [005](../005-optional-cloud-qa/spec.md). `[P]` means independent files after prerequisite gates. Backend owns helper/route/backend tests; component owns picker/styles/component tests; root owns HousePlanner/browser integration and final evidence.

## Phase 1: Setup

- [x] T001 Review installed Next server/client guides and current authorization/release conventions; record design assumptions in `specs/004-featured-documents/research.md` (FR-006, FR-007, FR-008, FR-011).

## Phase 2: Foundational

- [x] T002 Add parsing/deduplication/ordered-delta/cap tests in `tests/featured-documents.test.ts`, including empty arrays, malformed IDs and overlap (FR-004, FR-005, FR-010).
- [x] T003 Implement pure types/IDs/delta helpers in `lib/featured-documents.ts`, enforcing "maximum 30 valid globally stored references" with stable retained-order and input-order additions (FR-004, FR-005).

**Gate**: Shared helper contract/tests pass before parallel implementation.

## Phase 3: US1 - Find featured documents (P1)

**Independent check**: Documents-only readers see eligible saved-order entries, folders and explicit Unfiled; excluded/stale references are absent.

- [x] T004 [US1] Add GET grant/project/deletion/encrypted-ancestor/reserved/invalid-ancestry cases in `tests/featured-documents-route.test.ts`, including read-only empty config and no Overview dependency (FR-006, FR-007, FR-008, FR-010).
- [x] T005 [US1] Implement filtered private/no-store GET in `app/api/documents/featured/route.ts`, preserving storage on read and requiring Documents independently of Overview (FR-004, FR-006, FR-007, FR-008).
- [x] T006 [US1] Integrate Featured default, folder grid, explicit Unfiled and current server projection in `app/HousePlanner.tsx`; reuse rows/preview/download and discard obsolete project responses (FR-001, FR-002, FR-006).
- [x] T007 [US1] Add synthetic default/empty/order/folder/Unfiled browser journeys in `e2e/featured-documents.spec.ts` (FR-001, FR-006, FR-010).

## Phase 4: US2 - Curate without moving files (P1)

**Independent check**: Search/full paths/save/cancel/error are usable; viewers cannot curate, and feature/root drops do not move files.

- [x] T008 [US2] Add PATCH role/target/atomic-denial/cap/metadata-hygiene tests in `tests/featured-documents-route.test.ts`; valid hidden references survive, invalid submitted removals deny before pruning, unrelated CONFIG fields remain unchanged (FR-004, FR-005, FR-007, FR-008, FR-010).
- [x] T009 [US2] Implement authorized incremental transactional PATCH in `app/api/documents/featured/route.ts`, validate all submitted IDs first, prune only structural unavailability on accepted changes and merge ordered IDs within the 30-valid-reference cap (FR-004, FR-005, FR-007, FR-008).
- [x] T010 [P] [US2] Add search/full-path/check/save/cancel/failure/retry tests in `tests/featured-documents-selection.test.tsx`, proving saved state unchanged and failed drafts retained (FR-003, FR-010).
- [x] T011 [P] [US2] Implement reusable hook/native picker in `app/components/FeaturedDocumentsSelection.tsx` and responsive `app/components/featured-documents.css`; snapshot the eligible-file visible baseline on open and send its additions/removals only; save accepts a delta and returns success (FR-003, FR-005).
- [x] T012 [US2] Integrate picker/manage controls in `app/HousePlanner.tsx`, preserve preview/download/full-path navigation and explicit Unfiled/folder handlers; hide Featured drag/folder-change/description/quote/delete controls and moves to Unfiled (FR-002, FR-003, FR-005, FR-007).
- [x] T013 [US2] Add cancellation/error/viewer/root-drop and preserved ordinary operations in `e2e/featured-documents.spec.ts` (FR-002, FR-003, FR-007, FR-010).

## Phase 5: US3 - Preserve shared and demo state (P2)

**Independent check**: Restricted/concurrent edits preserve valid hidden references; demo selection/drafts survive language/navigation without remote calls.

- [x] T014 [P] [US3] Add transaction-retry/concurrent additions/valid-hidden/structural-cleanup/global-limit/revoked-grant regressions in `tests/featured-documents-route.test.ts` (FR-004, FR-005, FR-006, FR-008, FR-010).
- [x] T015 [US3] Own demo featured IDs in `app/HousePlanner.tsx`, preserve saved state across navigation/locale, custom/private text intact, and zero featured API calls in demo (FR-009).
- [x] T016 [US3] Cover bilingual saved/open-draft preservation in `tests/featured-documents-selection.test.tsx` and demo navigation/zero-API assertions in `e2e/featured-documents.spec.ts` (FR-009, FR-010).

## Phase 6: Cross-Cutting Verification and Evidence

- [x] T017 Manually review synthetic desktop/mobile collection/dialog/document journeys and record observations/private evidence/limitations in `specs/004-featured-documents/validation.md` (FR-001, FR-002, FR-003, FR-009, FR-010).
- [x] T018 Run affected tests, full lint/test/build/docs and source-specific CI; record actual counts/status/source in `specs/004-featured-documents/validation.md` (FR-010, FR-011).
- [x] T019 Add genuine implementation/validation commits and evidence to `specs/004-featured-documents/traceability.md`, `traceability.json`, `validation.md` and `convergence.md`; preserve 001-003 and close only proved tasks (FR-001, FR-002, FR-003, FR-004, FR-005, FR-006, FR-007, FR-008, FR-009, FR-010, FR-011).
- [x] T020 Record the original server-change classification, its separate author-approved policy amendment in 005, unchanged cost controls and actual release status in `specs/004-featured-documents/convergence.md`; do not invent cloud/deployment evidence (FR-011).

## Dependencies, Parallel Examples and Strategy

T001 -> T002/T003 foundation -> backend T004/T005/T008/T009 and component T010/T011 in separate files. Tests precede their corresponding implementation; T011 requires T010 and foundation. Root T006/T012 waits for stable interfaces. T007/T013 validate integrated US1/US2 independently. T014 can proceed separately from root T015 after backend PATCH; T016 follows demo/picker integration. T017-T020 close measured development evidence, with no implicit release.

Parallel examples: backend route tests/handler versus component tests/picker after shared foundation; backend concurrency tests versus root demo state after PATCH. Same-owner shared files are edited sequentially. Total: 20 tasks (setup/foundation 3, US1 4, US2 6, US3 3, final 4). Establish the shared contract, independently verify read-only US1, then curation US2 and concurrency/demo US3. Record real test-first failures/results only when observed; completed observed outcomes and limitations are recorded in validation.md.

## Evidence Checkpoint 2026-10-14

Code source `34088995f1a151622212be0a0a7047c10bc1a797`; 1,149 complete unit tests, 9 new mocked-browser cases and the physical local-emulator 8-case permissions suite plus separate 1-case cleanup passed. The webpack build passed. This was a partial checkpoint and did not itself close T018/T019; the later acceptance below does.

## Application Acceptance 2026-10-14

Application source `19afb20ea081d28b1ed1e157467fe967aac2b028` / tree `697aee76264c9ac699d8dff63ee4a1643350fd5c` has trusted CI run 38596662823: docs 74/303/0, complete lint, 114 test files / 1,149 tests, webpack build, 232 routine browser cases, 8 physical emulator permission cases plus 1 separate cleanup case. The focused new browser suite has 10 cases including measured touch/rotation. Manual feature curation and role-isolation acceptance is complete with explicit blocked ancillary upload/PDF limits and both guarded sessions cleaned. Genuine commits and requirement mappings are in [traceability](traceability.md). No production delivery or cloud-QA approval is implied. Later 005 policy code requires its own final-source validation.
