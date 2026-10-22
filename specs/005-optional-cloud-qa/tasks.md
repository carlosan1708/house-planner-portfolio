# Tasks: Optional cloud QA

> Historical private-development record. Its commit IDs are metadata only; the original commit objects and review evidence are retained privately and are not part of this public snapshot. See [snapshot provenance](../../docs/portfolio/snapshot.md).

**Input**: [spec](spec.md), [plan](plan.md), constitution1.1.0.

## Setup and Foundation

- [x] T001 Review active release/QA gates and record the explicit author decision in `.specify/memory/constitution.md` and `specs/005-optional-cloud-qa/spec.md` (FR-005, FR-006, FR-008).
- [x] T002 Define preserved evidence/source boundaries and independent file ownership in `specs/005-optional-cloud-qa/plan.md` (FR-001, FR-002, FR-003, FR-007).

## US1 - Complete CI for every change

- [x] T003 [US1] Expand ordinary A/M/D source inventory while preserving all trusted provenance/job checks in `scripts/release-ci.mjs`; add meaningful acceptance/rejection tests in `tests/release-ci.test.ts` (FR-001, FR-002, FR-003).
- [x] T004 [US1] Default `scripts/deploy-gcp.ps1` to CI, update messages and preserve selected-evidence/candidate/promotion checks (FR-004, FR-007).

## US2 - Explicit optional cloud sessions

- [x] T005 [P] [US2] Update `AGENTS.md`, `docs/qa-workflow.md` and `docs/manual-browser-qa.md` with per-session approval, substantial reason/request, scope/cost and no automatic fallback; preserve cleanup/cost controls (FR-005, FR-006, FR-007).

## US3 - Honest release evidence

- [x] T006 [P] [US3] Align `docs/operations/releases.md`, `docs/development/testing.md`, `CONTRIBUTING.md`, `README.md` and documentation index with full-CI releases and live-check omissions (FR-001, FR-004, FR-007).
- [x] T007 [US3] Record the dated policy amendment in unfinished004 evidence and preserve001-003 in `specs/004-featured-documents/convergence.md` and `docs/development/sdd.md` (FR-008).

## Final Verification

- [ ] T008 Run focused/full checks, source-specific CI and consistency review; record real commits/tests/limits in `specs/005-optional-cloud-qa/validation.md` (FR-001 through FR-008).
- [ ] T009 Complete the already authorized normal merge, main CI, backup, zero-traffic candidate, exact-source promotion and public contract/traffic verification; record the actual result in `specs/005-optional-cloud-qa/validation.md` (FR-002, FR-004, FR-007).

T001→T002→analysis/design gate→T003/T004 and independent T005/T006→T007→T008→T009. Parallel release and documentation agents own distinct files; shared documentation is edited by its assigned owner. Nine tasks, US1 two, US2 one, US3 two, setup two and final two. Tests verify real provenance boundaries, not implementation mirroring.

## Source Freeze

Implementation and local acceptance are complete at the freeze. T008/T009 retain unchecked external CI/delivery steps until actual execution; the private PR release receipt records their eventual run/source/revision results without changing the tested source after promotion. See [validation](validation.md).

## CI Readiness Finding - 2026-10-14

- [x] T010 Stabilize the existing six-session bootstrap in `e2e/qa-permissions.spec.ts`: await completed authenticated workspace UI/route and validate each identity before returning; preserve every editor/viewer/isolation denial and cleanup assertion (FR-002, FR-005, FR-007).

Run38636346795 at55484eb passed docs/lint/units/build/browser, but the editor case's Notes navigation was interrupted by the sign-in Overview reload. The helper had returned onAPI200 before the UI session reload finished. One permission case passed, one failed, six did not run; separate cleanup passed. This is a missing readiness barrier, not proof of an authorization regression. T010 precedes closingT008/T009; ten tasks total. No test skip/retry, arbitrary sleep, relaxed denial or cloud fallback is introduced.

T010 accepted locally at`c4f1be49d8a1b80d003d76f808c513f7a37d5a7c`: all8 physical permissions cases and separate cleanup passed. Exact amended-source CI and publication remain the externalT008/T009 obligations.

## Concurrent Main Integration - 2026-10-14

- [x] T011 Integrate the separately reviewed current mainPR48 (`0e96e2de775a510a5b627eee7bfba3535e9ec96a`) into this release branch, preserve both README/product changes and complete local validation; hand fresh exact-source CI to T008 before candidate/merge/promotion (FR-002, FR-007).

ExactCI38639143579 passed atce11033, but main advanced during that run. No candidate or traffic change was made from the stale baseline. PR48 has its own authorized release in progress; verify its deployed tree matches the new first-parent baseline before this release promotes. T011 precedes externalT008/T009; eleven tasks total. Do not reinterpret earlierCI as combined-source evidence or relax the deployed-baseline gate.

## Native Touch Readiness Finding - 2026-10-14

- [x] T012 Await native document scroll completion in the existing mobile touch helper before subsequent taps, retaining real movement, saved-note persistence and restored-scroll assertions in `e2e/mobile-experience.spec.ts`; rerun complete routine browser regression and then physical permissions serially (FR-002, FR-007).

The first integrated local browser run passed231 cases and failed one: the saved-note dialog did not reopen after a native touch pan. Trace review confirms PATCH200 with the exact saved text, restored body overflow and actual scroll movement; the following tap completed but no dialog opened. It does not establish a persistence or application regression. The helper lacks a native scroll-completion barrier. Record this finding before the minimal test-only readiness change, with no extra tap, sleep, retry, skipped assertion or timeout increase. Twelve tasks total.

The simultaneously launched physical emulator suite stopped at Next startup because both runners shared the development lock; zero permission cases ran. This orchestration mistake is not a permission result and does not explain the separate esbuild mobile harness failure. Subsequent suites run serially.

## Integrated Local Closure and Final Source Freeze

T011 integration was specified in `935fb26b8a3dffcf4e5ca4f26a9f7b174f181620` before merge `38f16eba5779fb79183b7b9702fca2878f32112e`. Its checked scope is integration and local acceptance; final source-specific CI remains assigned to T008. T012 was specified in `aef824d1e4e153c2679af4abc64dc067ce0ff8db` before test correction `42a000ad41b7e5f961935a0092de5297eec66454`. The native-mobile 11-case suite and complete 232-case routine suite passed; the physical 8-case permissions suite and separate cleanup then passed serially at source `468a5df855db2fc64ce9532471130d5a8af6edc5`, tree `63c17cf6ce02437d4c7e15e5b83c189434eaff07`. Integrated units 116 files/1,174 tests, lint and build also passed. [Validation](validation.md#integrated-local-acceptance-before-final-freeze) preserves the earlier failed/zero-case attempts and exact evidence limits.

T001-T007 and T010-T012 are checked for completed implementation/local work. T008/T009 remain unchecked until complete final-source CI and production release have actual external receipts. Twelve tasks total; no task or historical result is silently treated as an already completed deployment. Freeze this evidence before external CI/candidate/normal merge/main CI/promotion; do not change the tested tree merely to record later receipt results.
