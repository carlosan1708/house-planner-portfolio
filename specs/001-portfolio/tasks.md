# Tasks: AI Engineer portfolio preparation

> Historical private-development record. Its commit IDs are metadata only; the original commit objects and review evidence are retained privately and are not part of this public snapshot. See [snapshot provenance](../../docs/portfolio/snapshot.md).

**Input**: [spec.md](spec.md), [plan.md](plan.md), [research.md](research.md)

## Phase 1: Setup

- [x] T001 Save offline Git bundles, remote mirror, local patch, untracked files, and original file fingerprints outside the repository (FR-007, FR-012).
- [x] T002 Install pinned Spec Kit 1.2.0 Codex assets in `.specify/` and `.agents/skills/`; define `.specify/memory/constitution.md` (FR-003).

## Phase 2: Foundations

- [x] T003 Commit `specs/001-portfolio/spec.md` and its clarified requirements before implementation (FR-004).
- [x] T004 Commit `specs/001-portfolio/plan.md`, `research.md`, `data-model.md`, and `quickstart.md` (FR-004).
- [x] T005 Record consistency analysis in `specs/001-portfolio/analysis.md` before implementation (FR-004).

## Phase 3: User Story 1 - Product and engineering

**Independent test**: Follow the README to the synthetic demo, architecture, and reproducible checks.

- [x] T006 [US1] Rewrite `README.md` and create `docs/README.md` with audience-oriented navigation (FR-001, FR-002).
- [x] T007 [US1] Create `docs/architecture/system.md`, `assistant.md`, `workbooks.md`, and `distribution.md` with verified trade-offs (FR-002, FR-010).
- [x] T008 [US1] Update `DEVELOPMENT.md` and add `docs/development/testing.md` and `docs/operations/releases.md` using synthetic setup and current commands (FR-001, FR-011).
- [x] T009 [US1] Capture synthetic demo screenshots into `docs/images/` and verify the rendered product locally (FR-001, FR-009).

## Phase 4: User Story 2 - Development evidence

**Independent test**: Follow one requirement through task, implementation commit, and validation.

- [x] T010 [US2] Create `docs/development/sdd.md`, `CONTRIBUTING.md`, and `.github/pull_request_template.md` (FR-003, FR-004).
- [x] T011 [US2] Create exactly three reconstructed cases under `docs/development/cases/` with verified implementation/test references (FR-005).
- [x] T012 [US2] Create `scripts/check-docs.mjs`, wire `docs:check` in `package.json` and CI, and validate local links/anchors and required SDD artifacts (FR-011).

## Phase 5: User Story 3 - Safe publication candidate

**Independent test**: Verify original recovery, mapped history equivalence, and unchanged GitHub/profile state.

- [x] T013 [US3] Add `docs/portfolio/profile-card.md` matching the existing profile's HTML card format (FR-006).
- [x] T014 [US3] Replace the client generator with `scripts/prepare-demo-house.mjs` and migrate dependent tests to `tests/synthetic-*.test.ts` (FR-009, FR-011).
- [x] T015 [US3] Rewrite every reachable historical blob/message under a private, explicit sanitation policy and save an offline commit map (FR-007, FR-008, FR-009).
- [x] T016 [US3] Verify author/committer timestamps, mapped parents, every mapped tree, and backup recovery; record a publication-safe report in `docs/portfolio/sanitation.md` (FR-007, FR-008, FR-009).
- [x] T017 [US3] Document operator migration and changed release SHA semantics in `docs/operations/history-migration.md`; preserve release gates and legal notices (FR-010).
- [x] T018 [US3] Confirm original workspace fingerprints, GitHub main/visibility, and profile README hash are unchanged; prepare local delivery only (FR-012).

## Phase 6: Polish and convergence

- [x] T019 Run docs check, lint, unit tests, build, and selected local browser checks; record results and omissions in `specs/001-portfolio/validation.md` (FR-011).
- [x] T020 Fill `specs/001-portfolio/traceability.md` with requirement -> decision -> task -> commit -> validation evidence (FR-004).
- [x] T021 Record final convergence in `specs/001-portfolio/convergence.md`; all requirements must be satisfied or explicitly reported unresolved (FR-004).

## Dependencies and execution strategy

Setup -> foundations -> presentation/evidence -> sanitation/history -> validation -> convergence.
T014 precedes history sanitation; T015 precedes history comparison and final commit references.
No task authorizes pushing rewritten history, public artifacts, paid QA, or production deployment.

Independent documentation sections can be drafted separately after foundations; writes and Git
mutations remain sequential. No parallel implementation agents are required for this delivery.
The MVP is US1; this request completes US1-US3 and records the final limits together.
