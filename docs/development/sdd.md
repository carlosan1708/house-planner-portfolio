# Spec-Driven Development with GitHub Spec Kit

This repository adopts [GitHub Spec Kit](https://github.com/github/spec-kit) **1.2.0** with its
Codex integration. The kit is tooling for a reviewable process; its badge alone is not evidence
that every historical feature followed that process.

## What was used for this delivery

The installed shared infrastructure lives in `.specify/`; reusable Codex skills live in
`.agents/skills/`. The integration record pins the kit version, Codex and PowerShell scripts.
The [constitution](../../.specify/memory/constitution.md) states actual project guardrails.

For the portfolio preparation, the sequence was:

1. **Constitution** — preserve access boundaries, synthetic examples, reviewable AI and release provenance.
2. **Specify and clarify** — define audience, outcomes, privacy scope, repository visibility and acceptance criteria.
3. **Plan** — inspect the current repository, record decisions, and choose documentation/history boundaries.
4. **Tasks** — order the implementation and map work to requirements and reader journeys.
5. **Analyze** — check coverage and resolve conflicting claims before implementation.
6. **Implement** — author docs, replace private fixtures, add checks and prepare the local history rewrite.
7. **Converge** — compare the result against the specification and record acceptance evidence and limits.

Read the [specification](../../specs/001-portfolio/spec.md), [plan](../../specs/001-portfolio/plan.md),
[tasks](../../specs/001-portfolio/tasks.md), [analysis](../../specs/001-portfolio/analysis.md),
[traceability](../../specs/001-portfolio/traceability.md) and [final assessment](../../specs/001-portfolio/convergence.md).
These are historical private-development records. Their commit IDs are preserved as metadata
in [the private-history reference manifest](../portfolio/private-history-references.json);
this public repository does not contain those commit objects. The documentation checker validates
local artifacts and explicitly declared historical references without claiming to re-execute
private history.

## Reproduce the kit setup

Use a clean branch or separate clone. Initialization merges managed files and can overwrite
conflicting paths; review its diff rather than running it over uncommitted work.

```powershell
python -m venv .venv-speckit
.venv-speckit/Scripts/python.exe -m pip install "git+https://github.com/github/spec-kit.git@v1.2.0"
.venv-speckit/Scripts/specify.exe init --here --force --non-interactive --integration codex --script ps
```

The kit is pinned to upstream tag `v1.2.0`, source commit
`7d7927c89d358d61a08db777c28c3f59f9b180ef`. Keep the installation environment and generated
session state out of Git. Upstream [existing-project adoption](https://github.github.io/spec-kit/guides/existing-projects.html)
and [integration documentation](https://github.github.io/spec-kit/reference/integrations.html)
explain the workflow; consult the pinned skills when current web docs differ.

## Use the workflow in Codex

Invoke these skills in the agent conversation, not as shell commands:

```text
$speckit-constitution
$speckit-specify
$speckit-clarify
$speckit-plan
$speckit-tasks
$speckit-analyze
$speckit-implement
$speckit-converge
```

Review each artifact before moving on. Constitution changes are separate from feature changes.
Create one bounded feature folder for each new delivery, keep requirement IDs stable, and connect
tasks to code/tests. The local `.specify/feature.json` selects the active folder; it is ignored
session state, not a portable assumption about another developer's branch.

Completed folders are historical records. A follow-up gets a new folder; discoveries can amend
the active delivery before completion, with the rationale recorded. Re-run consistency checks
after material intent changes. Do not mark validation complete merely because code was generated.

## Codex and author responsibility

Codex assisted with repository research, drafting, implementation and local verification.
The author provided requirements and constraints, selected the approach, and retains responsibility
for review and acceptance. Generated artifacts are checked against source and observed results.

The [three existing-feature cases](cases/README.md) are retrospective explanations of current
behavior. The history rewrite changes messages and privacy content; it does not create earlier
specifications, preserve old signatures, or establish new live QA evidence.

## Operational integration after preparation

The completed 001 records and their commits are preserved in the private `codex/portfolio-sdd`
archive. [002](../../specs/002-portfolio-release/spec.md) defines the subsequent integration and
authorized release on current operational main, with its own plan, tasks, analysis and validation.
It imports the presentation and synthetic fixtures without copying sanitized operational IDs.
The documentation gate checks both feature folders and referenced commit objects. Archived test
counts remain archive evidence; current CI and deployed QA are recorded separately.

## Demo localization follow-up

[003](../../specs/003-demo-localization/spec.md) begins from an observed mixed-language demo.
Its specification precedes the implementation; the plan makes seed ownership, edit preservation
and private-data boundaries explicit. Regression tests include deliberately edited translations,
open forms, stable numeric/date values, filtered collections and typed synthetic downloads.
Its [traceability](../../specs/003-demo-localization/traceability.md) connects those decisions to tasks,
commits and [measured checks](../../specs/003-demo-localization/validation.md). Completed 001/002
records remain historical evidence. A new release requires fresh exact-source acceptance.

## Featured Documents Follow-Up

[004](../../specs/004-featured-documents/spec.md) records the author's Documents landing-page request before implementation. Its committed [plan](../../specs/004-featured-documents/plan.md), [tasks](../../specs/004-featured-documents/tasks.md) and [analysis](../../specs/004-featured-documents/analysis.md) define project-level incremental selection, preservation of grant-hidden references, encrypted/reserved exclusions and local-only demo state.

A consistency review resolved an unusable full-list case through structural reference cleanup only within an accepted save; it is labeled an engineering default rather than invented author approval. Independent implementation review found native child dragging could move a featured file; the corrected guard has a browser regression. [Traceability](../../specs/004-featured-documents/traceability.md) connects real specification/design/implementation commits to tracked tests and [measured evidence](../../specs/004-featured-documents/validation.md).

The record distinguishes deterministic tests, mocked browser journeys, real local emulators and scoped manual review. Application source `19afb20` passed complete trusted CI: 1,149 unit tests, 232 routine browser cases, physical permission/cleanup checks, lint and build. The manual record identifies both guarded sessions, role isolation, cleanup and blocked ancillary upload/PDF limits. The author's separate [005 policy amendment](../../specs/005-optional-cloud-qa/spec.md) makes cloud QA optional for every change and requires explicit per-run approval; offer it only for substantial need or a user request. Feature004 application acceptance does not establish later policy-source CI or production delivery. Completed 001-003 snapshots remain unchanged.
