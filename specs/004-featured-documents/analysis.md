# Specification Analysis Report

> Historical private-development record. Its commit IDs are metadata only; the original commit objects and review evidence are retained privately and are not part of this public snapshot. See [snapshot provenance](../../docs/portfolio/snapshot.md).

**Reviewed**: 2026-10-13, after prepared design/tasks and before implementation. Report of read-only cross-artifact review; no runtime result is claimed by that original analysis. The dated application closeout and separate author-approved 005 policy amendment are recorded below; earlier pending statements/classifications are historical checkpoints.

## Findings

| ID | Category | Severity | Location | Finding / disposition |
|---|---|---|---|---|
| C1 | Consistency | Resolved before code | spec FR-004/005; plan decisions 2-3 | Permanently invalid hidden references could consume every slot. Active design now prunes only structural unavailability in an otherwise accepted PATCH, preserves valid grant-hidden references, and forbids cleanup on GET/rejected input. This is an engineering default, not literal author approval. |

No unresolved critical/high conflict was identified. Documents placement, explicit Unfiled, atomic latest-state changes, preserved ordering, access/vault/reserved exclusions, draft state and parent-owned demo IDs are consistent across artifacts. The picker snapshots only saved IDs represented by eligible candidate files, avoiding unintended removal when file data is stale. Featured rows retain preview/download/path navigation but hide ordinary mutations; explicit folder/Unfiled operations remain. Release remains a distinct pending boundary.

## Coverage

| Requirement | Tasks | Intended check |
|---|---|---|
| FR-001 | T006, T007, T017, T019 | Default/empty/folder/Unfiled journeys. |
| FR-002 | T006, T012, T013, T017, T019 | No file mutation; drop and ordinary-operation preservation. |
| FR-003 | T010, T011, T012, T013, T017, T019 | Search/full paths/checks/cancel/error/draft. |
| FR-004 | T002, T003, T005, T008, T009, T014, T019 | Order/uniqueness/global cap/read-only GET. |
| FR-005 | T002, T003, T008, T009, T011, T012, T014, T019 | Incremental transaction, hidden/concurrent preservation, guarded cleanup. |
| FR-006 | T001, T004, T005, T006, T007, T014, T019 | Documents independent of Overview, filtered current read. |
| FR-007 | T001, T004, T005, T008, T009, T012, T013, T019 | Role/read-only/current grant enforcement. |
| FR-008 | T001, T004, T005, T008, T009, T014, T019 | Project/deletion/vault/reserved/ancestry exclusion. |
| FR-009 | T015, T016, T017, T019 | Demo navigation/locale/draft preservation and zero API. |
| FR-010 | T002, T004, T007, T008, T010, T013, T014, T016, T017, T018, T019 | Distinct measured local/CI/manual evidence. |
| FR-011 | T001, T018, T019, T020 | Old snapshots unchanged; normal server release/cost gates. |

SC-001 through SC-006 map to those same journey, limit/security, concurrency, demo and closeout tasks. No unmapped task exists.

## Metrics and Next Actions

11 functional requirements, 6 success criteria, 20 tasks; functional task coverage 11/11 (100% planned coverage). Unresolved clarification markers 0; blocking ambiguities/critical constitutional conflicts identified 0. One consistency defect resolved before code. Planned coverage is not executed coverage; every implementation/check task remains pending.

Constitution 1.0.3 reviewed before/after design, no exception requested, no extension hook file. Commit design, then tasks/analysis before code; re-analyze if implementation changes the contract. Final measured local/CI/manual evidence and separately authorized server release remain pending.

## Implementation Review Checkpoint 2026-10-14

Reviewed the integrated Documents root/picker and the current source tests against all 11 functional requirements, the active contract and constitution. The native child link/thumbnail drag issue was found during independent review and corrected in UI commit `101a199d1c0de682555757c7607c8d6688976171`; its browser regression verifies zero file moves. Current source aligns with the visible-file opening baseline, incremental saves, private access checks, encrypted/reserved exclusion, separate Unfiled and parent-owned demo state.

Code checkpoint `34088995f1a151622212be0a0a7047c10bc1a797` has the measured local checks in [validation](validation.md). Remaining development obligations already map to T017-T019: manual review, final build/full browser/CI and final traceability acceptance. No duplicate convergence tasks were appended, no new code change is proposed from this checkpoint, and convergence is not yet declared. Physical permissions evidence is narrower than the simulated unit race/vault/deletion boundaries.

## Application Acceptance and Policy Separation 2026-10-14

The original analysis above is a preimplementation/checkpoint record. Its remaining T017-T019 obligations are now complete for application source `19afb20ea081d28b1ed1e157467fe967aac2b028`: complete trusted CI, synthetic manual feature/role acceptance with disclosed ancillary limits, and genuine requirement/task/commit mapping. No remaining application-contract inconsistency was identified. [Validation](validation.md) records corrected earlier failures rather than removing them from history.

FR-011 has a separate author-approved operational amendment in [005](../005-optional-cloud-qa/spec.md): cloud QA optional for every change, explicit approval per run, and offered only for substantial need or user request. This supersedes the historical mandatory server-cloud-QA classification, while source-specific CI, backup, isolation, provenance and cost controls remain applicable. Application acceptance does not claim final integrated policy CI or deployment.
