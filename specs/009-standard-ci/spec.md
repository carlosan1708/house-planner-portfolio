# Standard CI and optional full regression

> Historical private-development record. Its commit IDs are metadata only; the original commit objects and review evidence are retained privately and are not part of this public snapshot. See [snapshot provenance](../../docs/portfolio/snapshot.md).

Specified before implementation on 2026-10-14. The user explicitly requests mandatory code review/static checks, unit tests and application compilation, with applicable Playwright coverage; complete regression must be optional or requested. This supersedes the mandatory-complete-CI part of policy 005 and continues the pending authorized deployment without cloud QA.

- FR-001: Default PR/main CI requires documentation checks, lint, all unit tests and application build.
- FR-002: Run bounded Playwright coverage selected from actual changed paths when applicable; record the selection and allow justified skips for non-browser changes.
- FR-003: Full routine browser regression and six-user local-emulator permissions move to an explicit manual workflow, never PR/main automatic triggers. Cloud QA retains independent per-session approval.
- FR-004: Promotion accepts complete standard-CI evidence for the exact normal merge/candidate/current production baseline. Missing mandatory or applicable browser checks, altered trusted controls and stale/mismatched evidence remain rejected.
- FR-005: Update active guides, instructions and skills without rewriting completed historical evidence. Retain backup, zero-traffic candidate, exact source and traffic checks; publish the pending operational skills/policy change with the authorized standard lane.
