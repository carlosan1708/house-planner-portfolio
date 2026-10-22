# Release tasks

> Historical private-development record. Its commit IDs are metadata only; the original commit objects and review evidence are retained privately and are not part of this public snapshot. See [snapshot provenance](../../docs/portfolio/snapshot.md).

- [x] T001 Define operational integration requirements and constraints (FR-001, FR-002, FR-006).
- [x] T002 Plan whitelist, archive preservation and gated release order (FR-001, FR-002, FR-004, FR-005).
- [x] T003 Import documentation, Spec Kit and synthetic fixtures; preserve operational runtime/config (FR-001).
- [x] T004 Make archive/current scope explicit and keep original traceability reachable (FR-002).
- [ ] T005 Validate local checks and CI for final committed source (FR-003).
- [x] T006 Obtain explicit approval if the enforced QA budget must increase, then apply consistent limits without resetting the ledger (FR-006).
- [ ] T007 Verify production backup and zero-traffic candidate provenance (FR-004).
- [ ] T008 Deploy exact source to isolated QA; pass full/basic eight suites and cleanup (FR-004).
- [ ] T009 Merge tested tree, promote same revision and verify production (FR-005).
- [ ] T010 Record traceability, measured results, failures, limits and final outcome (FR-002, FR-003, FR-004, FR-005, FR-006).

This is the committed pre-release checklist, finalized before deployment. Remaining CI/cloud
steps are audited in PR #45 (private development record); see
[validation](validation.md#source-snapshot-and-later-release-evidence) for the evidence boundary.
