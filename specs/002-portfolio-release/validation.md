# Operational integration validation

> Historical private-development record. Its commit IDs are metadata only; the original commit objects and review evidence are retained privately and are not part of this public snapshot. See [snapshot provenance](../../docs/portfolio/snapshot.md).

**Status**: Source checks passed; CI and exact-source cloud release remain gated.
**Recorded**: 2026-10-13, before candidate deployment.
**Release report**: private PR #45 (private development record).

This record applies to 002 on operational main, not the completed sanitized archive. Current local checks are recorded below; CI and deployed results are retained in the private PR. Backup, trusted full/basic QA and
promotion evidence are produced externally for the exact source commit/tree, avoiding a source
change merely to record the same deployment. The private integration PR will retain that final
release report and workflow links. An uncompleted source checklist is a dated pre-release snapshot;
it is not a claim that cloud checks already passed.

## Limits

No production data repair, public visibility change, profile README edit, real Sheets OAuth test,
Gmail delivery or unrestricted model evaluation is included. A failed/missing QA gate blocks
merge and promotion; archive check counts cannot substitute for this release.

## Local integration checks

- Final full Vitest run after the approved budget change: 104 files and 980 tests passed; no failures.
- ESLint: passed.
- Documentation: 52 documents; 233 local references before this final report; zero errors.
- Runtime, deploy scripts, trusted QA workflow and production identifiers were unchanged by the portfolio import.
- Completed 001 artifacts compared file-by-file against the archive: zero differences.

## Approved QA budget change

On 2026-10-13 the user explicitly approved monthly target USD5.50, cutoff USD5.25 and maximum
ten builds. One source build plus full/basic regression forecasts USD5.20 from the existing
USD4.70 ledger. Prices, base reservation, ten regressions, spend caps and identity/source gates
remain in force. Known old/new budget messages are validated during the in-place transition.
No ledger reset or production data repair is authorized.

- Final webpack production build: passed, including TypeScript and 61 routes/pages.
- Full affected distribution browser suite: 13 Chromium scenarios passed in 20.1 seconds.
- Spec Kit integration status: ok; Codex; zero missing or modified managed files.
- Spec Kit prerequisites resolve the active 002 folder, plan and task artifacts.

The full distribution browser run initially exposed client-specific expectations left by the
archive's generator-only migration. The integration now supplies invented property/support/carport
fixtures and correct model/record revision expectations. All 13 scenarios pass without new skips
or runtime changes. The archive's earlier four demo checks never claimed this full browser suite.

## Verified pre-release backup

The production backup script completed successfully before candidate deployment on 2026-10-13.
Storage inventory/copy matched at 1,251 listed entries and 103,256,619 bytes. Firestore export
passed its SUCCESSFUL guard with 2,411 documents. The private log and exact backup prefix stay
in the operator's ignored release artifacts and the private PR release report.

## Source snapshot and later release evidence

The source checklist is intentionally a pre-release snapshot. Its remaining cloud tasks are
completed and audited in the private release report (private development record),
including CI run, candidate commit/tree/revision, all eight full/basic QA suites and cleanup,
merge tree and promotion verification. This avoids modifying the tested tree to record its own
deployment. No task is represented as passed before that evidence exists.
