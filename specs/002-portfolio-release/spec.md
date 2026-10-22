# Portfolio integration and verified release

> Historical private-development record. Its commit IDs are metadata only; the original commit objects and review evidence are retained privately and are not part of this public snapshot. See [snapshot provenance](../../docs/portfolio/snapshot.md).

**Created**: 2026-10-13
**Status**: In progress
**Baseline**: operational main `cd82b8f54b087e1ac9e89516f07d2c5edf5407cc`.

## User intent

Integrate the completed English portfolio and Spec Kit evidence, merge it into the private repository, deploy, and test thoroughly. Preserve the original working checkout and production data. Preparation in [001](../001-portfolio/spec.md) is a completed, separate historical record; this specification covers operational integration and release.

## Acceptance requirements

- FR-001: Import the portfolio documentation, pinned Spec Kit integration and synthetic fixtures without changing production project identifiers, authorization, secret references or trusted QA workflow.
- FR-002: Keep completed preparation evidence immutable and its commits reachable through a private archive branch; distinguish archive sanitation from the operational history retained on main.
- FR-003: Validate documentation references, unit tests, lint, build and synthetic browser behavior for this integration. Record exact source and measured results.
- FR-004: Verify a recoverable production backup, deploy a clean zero-traffic candidate, and require all eight isolated QA suites with basic AI plus cleanup for the exact candidate commit/tree.
- FR-005: Merge the tested tree, promote that same production revision, and verify traffic, source provenance and anonymous API contracts. Repository visibility and profile README remain unchanged.
- FR-006: Honor enforced QA cost limits. Any increase needs the user's explicit approval; retain the existing reservation ledger and cutoff enforcement.

## Clarifications and constraints

- The curated history changes operational default identifiers to examples and cannot be deployed over existing data. Use additive integration on current main; do not force-push a replacement history.
- The rewritten archive is a private reference, not a claim that operational main has been fully sanitized for public publication.
- This release changes presentation, development artifacts and synthetic fixtures. It does not repair production records.
- October QA currently reserves USD4.70 with nine builds, against cutoff USD4.75 and monthly target USD5.00. One additional build and regression forecast USD5.20; The user subsequently approved monthly target USD5.50, cutoff USD5.25 and maximum ten builds for this release; the existing ledger is preserved.

## Success and limits

Success requires recorded local/CI results and trusted full isolated QA, verified backup, exact-tree merge and same-revision promotion. Local tests or archived results cannot substitute for deployed QA. Real Google Sheets OAuth, Gmail delivery and unrestricted AI evaluation remain outside the standard regression evidence.
