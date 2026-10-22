# Featured Documents Traceability

> Historical private-development record. Its commit IDs are metadata only; the original commit objects and review evidence are retained privately and are not part of this public snapshot. See [snapshot provenance](../../docs/portfolio/snapshot.md).

**Status**: Specification-first application development accepted with measured local, trusted CI and scoped manual evidence; release recorded separately.

Accepted application source `19afb20ea081d28b1ed1e157467fe967aac2b028`; tree `697aee76264c9ac699d8dff63ee4a1643350fd5c`. The following commits are genuine delivery stages, not rewritten historical claims.

| Stage | Commit | Outcome |
|---|---|---|
| Specify/quality review | `14df06a8b09b44c4bf7e318c48cdeb477951159d` | Documents landing-page scope and acceptance recorded before code. |
| Technical plan | `7d6a5034765ce1761e85b7f6acc17a00500c91fa` | Dedicated route, transaction and structural-reference cleanup decisions. |
| Tasks/analysis | `941acb1f23db3a9534b5e385dcbe2dc379716e47` | Original dependency-ordered tasks and consistency analysis committed before implementation. |
| Additional design clarification | `d127ca94991d88ee89e2894a882774ecf4290e37` | Visible-file opening baseline and read-only Featured rows clarified; structural cleanup was already in the plan. |
| Pure selection contract | `347a970f756429f5dcae80dc2791243007afe6af` | Stable IDs/delta/order/cap helpers and deterministic tests. |
| Server route | `97a135da5e19769238b216189ad580d1571277e1` | Current authorization, filtered reads, incremental transaction and route tests. |
| UI/browser integration | `101a199d1c0de682555757c7607c8d6688976171` | Featured/Unfiled picker, demo preservation, read-only entry rows and child-drag regression. |
| Physical local permission test | `34088995f1a151622212be0a0a7047c10bc1a797` | Six-identity feature lifecycle added to the local emulator suite. |
| Existing browser expectation amendment | `f92e71af2fd58f1fe3f2a9ba92df35c08c78fdd0` | Tests explicitly select Unfiled while preserving inactive-authorship assertions. |
| Native touch/rotation verification | `073575857cba2cf8aa612e7faff8213a8efdd16b` | Raw Chromium touch scroll, body lock, bounded portrait/landscape and restored page scroll. |
| Measured evidence checkpoint | `9da82560f157880dcb4cee70bd772d2be1d33941` | Partial source-specific evidence recorded before final CI/manual acceptance. |
| Generated demo uploader correction | `19afb20ea081d28b1ed1e157467fe967aac2b028` | English/Spanish generated uploader labels, preserved real authors/custom names, expanded browser cases. |

| Requirement | Decision | Tasks | Tracked checks |
|---|---|---|---|
| FR-001 | Featured root + separate Unfiled/folders | T006, T007, T017, T019 | Featured browser journeys. |
| FR-002 | References only/read-only entry rows | T006, T012, T013, T017, T019 | Browser drag/ordinary actions; physical file preservation. |
| FR-003 | Native picker/draft/save isolation | T010, T011, T012, T013, T017, T019 | Component and browser cases. |
| FR-004 | Ordered IDs/global valid-reference cap | T002, T003, T005, T008, T009, T014, T019 | Pure/route and physical ordering cases. |
| FR-005 | Incremental transaction/guarded cleanup | T002, T003, T008, T009, T011, T012, T014, T019 | Unit retries/atomic failure; visible-baseline picker; real hidden-reference preservation. |
| FR-006 | Documents independent of Overview | T001, T004, T005, T006, T007, T014, T019 | Route and physical lifecycle. |
| FR-007 | Current role/section/folder grants | T001, T004, T005, T008, T009, T012, T013, T019 | Route, component and physical permission cases. |
| FR-008 | Ownership/deletion/vault/reserved/ancestry exclusion | T001, T004, T005, T008, T009, T014, T019 | Route boundaries, mocked browser exclusions, physical foreign/missing/grant denials. |
| FR-009 | Parent-owned demo state/zero API | T015, T016, T017, T019 | Component and synthetic browser preservation. |
| FR-010 | Distinct measured local/CI/manual results | T002, T004, T007, T008, T010, T013, T014, T016, T017, T018, T019 | Exact-source trusted CI; scoped manual acceptance; explicit ancillary limits. |
| FR-011 | Preserved controls and separately amended QA policy | T001, T018, T019, T020 | Original classification and author-approved 005 amendment; source-specific external status. |

[Design decisions](plan.md#decisions), [structured mapping](traceability.json), [measured validation and limits](validation.md), [development convergence](convergence.md). Physical emulator evidence does not claim vault creation/deletion/conflict races that were tested with deterministic fixtures. The engineering structural-cleanup default is not retroactively attributed to literal author approval. Earlier feature001-003 results remain separate historical evidence.

The earlier 90-case run had four root-default expectation failures; the first complete 231-case run and initial CI had two inactive-author assertion failures. Amendment `f92e71a` retains those assertions through explicit Unfiled selection. Later local 232-case acceptance at `9da8256` and exact-`19afb20` trusted CI 38596662823 (private development record) passed. The final focused count is 10, including measured touch/rotation and uploader-label regressions. [Validation](validation.md) distinguishes each actual source rather than claiming uninterrupted earlier success.

Two guarded normal-sign-in manual runs used the accepted application source; both restored synthetic fixtures, released their leases and stopped local services. The second completed administrator/viewer/restricted/outsider curation/isolation review after the first's file-chooser interruption. Ancillary upload/PDF rendering limits remain disclosed. The author's later [005 QA-policy amendment](../005-optional-cloud-qa/spec.md), its implementation and final integrated CI are a separate delivery; application CI here does not validate later policy code or prove production release.
