# Operational integration traceability

> Historical private-development record. Its commit IDs are metadata only; the original commit objects and review evidence are retained privately and are not part of this public snapshot. See [snapshot provenance](../../docs/portfolio/snapshot.md).

| Requirement | Decision | Tasks | Evidence |
|---|---|---|---|
| FR-001 | Preserve runtime; import whitelist | T001, T002, T003 | README, runtime diff and tests |
| FR-002 | Immutable private archive | T004, T010 | Archive ref, sanitation/history scope, structured records |
| FR-003 | Test current source independently | T005, T010 | Local checks and CI |
| FR-004 | Backup and trusted exact-source QA | T007, T008, T010 | External backup and full/basic workflow report |
| FR-005 | Exact tree and same revision | T009, T010 | External merge/promotion/provenance report |
| FR-006 | Approved limits; preserve ledger | T006, T010 | Budget decision and status |

The structured records initially reference the specification and plan commits. Implementation
commits and measured validation are added when they exist; external cloud evidence is linked in
[validation](validation.md) after execution, without relabeling preparation results.

Final measured local evidence and later exact-source cloud results are linked through
[validation](validation.md) and PR #45 (private development record).
The JSON lists actual specification, documentation, fixture and approved-budget commits.
