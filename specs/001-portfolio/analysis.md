# Pre-implementation consistency analysis

> Historical private-development record. Its commit IDs are metadata only; the original commit objects and review evidence are retained privately and are not part of this public snapshot. See [snapshot provenance](../../docs/portfolio/snapshot.md).

**Reviewed**: 2026-10-13, after tasks and before implementation.

**Result**: No blocking inconsistencies or unresolved user decisions.

| Requirements | Tasks | Acceptance evidence planned |
|---|---|---|
| FR-001–FR-002 | T006–T009 | README navigation, verified source references, synthetic demo captures |
| FR-003–FR-005 | T002–T005, T010–T011, T020–T021 | Pinned integration, chronological commits, exactly three retrospective cases |
| FR-006 | T013 | Profile HTML draft retained within House Planner |
| FR-007–FR-009 | T001, T014–T016 | Offline recovery, full commit mapping, explicit tree-transform comparison |
| FR-010 | T007, T017 | Authorization unchanged; future releases require fresh provenance |
| FR-011 | T008–T009, T012, T014, T019 | Documentation/lint/unit/build and scoped local browser results |
| FR-012 | T001, T018 | Original fingerprints and GitHub/profile read-only checks |

## Resolved findings

- **A1 — Incorrect demo AI claim**: Source research shows no assistant in the public demo.
  T006–T007 must correct the previous table rather than imply simulated model behavior.
- **A2 — Geometry privacy**: Renaming the current house generator is insufficient. T014 replaces
  the actual geometry and site-specific expectations with an invented model and behavior tests.
- **A3 — Approval concurrency limits**: Direct publication validates plan and actuals revisions;
  the approval transaction does not have identical checks. T007 must avoid claiming parity.
- **A4 — Encryption recovery**: Current source supports administrator password reset using a server
  recovery wrapper. T011 must describe current behavior, not older no-reset documentation.
- **A5 — Local scope**: Remote force-push and public publication remain excluded. A prepared local
  branch is the deliverable; old GitHub PR/cached references must be reviewed before publication.
- **A6 — Template placeholders**: Vendor templates are reusable inputs, not authored documentation.
  T012 excludes their intentional placeholders while checking the actual feature artifacts.

## Constitution and coverage

All five principles pass. Every requirement has tasks and acceptance checks; all user stories are
independently reviewable. No API schema changes or paid infrastructure work are necessary.

## Implementation review clarifications

Reviewed after the implementation was resumed on 2026-10-13, rather than claimed as prior research:

- Notes are shared project records, protected by Notes access. Authorized editors/admins control
  per-note AI opt-in; the author-only wording was corrected in docs and constitution 1.0.1.
- Fresh assistant retrieval is guarded, but prior document/budget replies are not revalidated
  against later access/vault changes. Documentation now states that conversation-history limit.
- Approved administrators have implicit vault grant authority; every content read still needs unlock.
- The initial traceability checker only matched FR identifiers. Validation was strengthened to
  verify task IDs, nonempty decision/evidence links, local commit objects and complete coverage.
- Replacing the old forbidden QA fixture identifier with the valid primary fixture made one
  denial assertion invalid. The historical transformation now substitutes a disallowed example
  without changing runtime QA authorization rules.
