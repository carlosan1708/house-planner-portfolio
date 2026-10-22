# Requirement-to-validation traceability

> Historical private-development record. Its commit IDs are metadata only; the original commit objects and review evidence are retained privately and are not part of this public snapshot. See [snapshot provenance](../../docs/portfolio/snapshot.md).

**Delivery**: [AI Engineer portfolio preparation](spec.md), begun specification-first on 2026-10-13.

Every requirement maps to a [design decision](plan.md#implementation-decisions), ordered tasks,
locally verified commit objects and evidence. The canonical machine-readable records are
[traceability.json](traceability.json); CI checks coverage, task IDs, decision/evidence targets and
commit objects. CI fetches full history for those object checks.

| Requirement | Tasks | Implementation/history commits | Primary evidence |
|---|---|---|---|
| FR-001 | T006, T008, T009 | `1d5ef16`, `5327bc5` | README.md |
| FR-002 | T006, T007 | `1d5ef16`, `7ce9f74` | docs/architecture/assistant.md |
| FR-003 | T002, T010 | `a7df087`, `1d5ef16` | .specify/integration.json |
| FR-004 | T003, T004, T005, T010, T020, T021 | `7bed084`, `cc66d98`, `0526230`, `7ce9f74` | specs/001-portfolio/spec.md |
| FR-005 | T011 | `1d5ef16`, `7ce9f74` | docs/development/cases/README.md |
| FR-006 | T013 | `1d5ef16` | docs/portfolio/profile-card.md |
| FR-007 | T001, T015, T016 | `cc66d98`, `a3b32dd` | docs/portfolio/sanitation.md |
| FR-008 | T015, T016 | `a7df087`, `7bed084`, `cc66d98`, `0526230`, `1d5ef16`, `a3b32dd`, `5327bc5` | docs/portfolio/sanitation.md |
| FR-009 | T014, T015, T016 | `a3b32dd`, `5327bc5` | scripts/prepare-demo-house.mjs |
| FR-010 | T007, T017 | `1d5ef16`, `7ce9f74` | docs/operations/releases.md |
| FR-011 | T008, T009, T012, T014, T019 | `a3b32dd`, `7ce9f74` | scripts/check-docs.mjs |
| FR-012 | T001, T018 | `7bed084`, `cc66d98` | docs/operations/history-migration.md |

## Chronological evidence

1. `a7df087` — install the pinned kit and project principles.
2. `7bed084` — specify outcomes and clarified constraints.
3. `cc66d98` — record decisions and implementation design.
4. `0526230` — define tasks and pre-implementation consistency review.
5. `1d5ef16` — implement the portfolio documentation and reconstructed cases.
6. `a3b32dd` — replace client-dependent regressions with an invented fixture and add checks.
7. `5327bc5` — retain visually inspected synthetic demo captures.
8. `7ce9f74` — reconcile factual review and validate structured traceability.

These commits exist in the local prepared branch. Their rewritten SHA values are not remote
GitHub links, because no push has occurred. Run `git show <SHA>` locally to inspect them.

The rewrite also covers the rest of the recovered history; its complete correspondence stays
offline. A mapped historic commit demonstrates its actual change, not prior use of Spec Kit.
Backup/preservation checks are execution evidence in [validation](validation.md), not fabricated
Git commits that contain the private recovery files.

[Final assessment](convergence.md) · [Publication-safe history report](../../docs/portfolio/sanitation.md)
