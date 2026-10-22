# Demo localization traceability

> Historical private-development record. Its commit IDs are metadata only; the original commit objects and review evidence are retained privately and are not part of this public snapshot. See [snapshot provenance](../../docs/portfolio/snapshot.md).

The [structured mapping](traceability.json) connects requirements, decisions, ordered tasks,
real commits and local evidence. Specification and plan were committed before implementation.

| Requirement | Decision and implementation | Tasks | Evidence |
|---|---|---|---|
| FR-001 | Project owned seed labels in EN/ES; preserve canonical status keys | T003–T005 | [Main](../../tests/main-demo-localization.test.ts), [budget](../../tests/demo-budget-localization.test.tsx), [expenses/gallery](../../tests/demo-expenses-aesthetics-localization.test.tsx) |
| FR-002 | Track edited fields; preserve record collections, dates and filter identity | T003–T006 | [Preservation regressions](../../tests/main-demo-localization.test.ts), [browser journey](../../e2e/demo-localization.spec.ts) |
| FR-003 | Scope projection to demo ownership; preserve private data and technical workbook identifiers | T003–T006 | [Typed synthetic checks](../../tests/main-demo-localization.test.ts), [validation](validation.md) |
| FR-004 | Local verification, fresh CI and measured limits | T006, T007, T010 | [Validation](validation.md) |
| FR-005 | Author-approved presentation CI, deployed baseline match and unchanged QA budget | T008–T010 | [Release controls](../../scripts/deploy-gcp.ps1), [CI rejection tests](../../tests/release-ci.test.ts), [validation](validation.md) |

The implementation commit is `4454838878b3835eae5e3e74a8f123d587767614`. The structured mapping includes the specification,
plan, active clarification and implementation commits. A source validation snapshot records checks
before CI and deployment; final exact-source acceptance belongs to the private review evidence.
Completed features 001 and 002 are unchanged; this is an independent follow-up delivery.

The author-approved FR-005 amendment precedes the control implementation:
`722cfd7f5e483583ade49493e79965495f81e517` →
`2eaf380fb328e6e819a3844dee78282e9ff6c3d1`. The mapping preserves the original UI specification
and implementation sequence and records the changed acceptance decision, rather than presenting
cloud QA as having passed. Source-specific final CI and production results are audited in
PR #46 (private development record).
