# Implementation Plan: Optional cloud QA

> Historical private-development record. Its commit IDs are metadata only; the original commit objects and review evidence are retained privately and are not part of this public snapshot. See [snapshot provenance](../../docs/portfolio/snapshot.md).

**Branch**: `codex/featured-documents` | **Date**: 2026-10-14 | **Spec**: [specification](spec.md)

## Summary

Expand the existing trusted complete-CI lane to all regular-file changes and default production validation to CI. Preserve its exact source, merge, private repository, pinned workflow, full job and deployed baseline checks. Amend active instructions to require explicit approval for every optional cloud session; offer it only for a specific substantial uncertainty or an explicit request.

## Technical Context

Node.js ESM release verifier, PowerShell production operator script and Vitest tests. Existing GitHub CI stays pinned and unchanged. Storage/schema/application APIs are unchanged by005; feature004 owns the Documents behavior. Target: existing private GitHub repository and Cloud Run service. No added dependencies, cloud QA operation, new budget or performance claim.

## Constitution Check

Constitution1.1.0 is amended separately before implementation under the author's explicit decision. Server authorization, project isolation, synthetic evidence and honest model claims remain intact. Meaningful verifier boundary tests and full CI remain mandatory; backup, zero-traffic candidate and exact promotion remain mandatory. Completed001-003 are immutable. Gate PASS before design and after this design review.

## Research and Decisions

- Existing `release-ci.mjs` path allowlist forces API/security changes into cloud. Replace it with a complete safe regular-file A/M/D inventory; no arbitrary path-category gate remains.
- Reject invalid paths, blobs and mode transitions, symlinks/submodules and incomplete inventories. Ordinary executable regular files are included; renames are represented as delete/add by existing `--no-renames` inventory.
- Preserve current-production-tree equality and normal-main-merge requirements. A validation failure stops promotion and requires corrected evidence, never a cloud fallback.
- `deploy-gcp.ps1` selects `ci` by default; `cloud` remains an explicit optional lane with its existing evidence verification. Candidate builds still receive zero traffic and readiness/identity checks.
- Human conversation approval is enforced by active agent/operator instructions. Adding a boolean would record an operator assertion, not prove human consent, so no such trust claim or extra workflow is introduced.
- Cloud setup/provision/build/regression/reservation and optional live AI must lie within the expressly approved session. Cleanup is part of that same scope. Cost caps and reservations remain unchanged.

## Structure and Ownership

Root owns constitution and005 spec/plan/tasks/analysis/validation. Release agent owns `scripts/release-ci.mjs`, `scripts/deploy-gcp.ps1`, `tests/release-ci.test.ts`. Documentation agent owns active agent/operator/testing/manual guides. Evidence agent closes004 measured feature evidence; it does not rewrite001-003. Parallel edits occur only after the design gate and in separate files.

## Validation and Delivery

Run verifier tests, complete lint/unit/build/docs, and source-specific trusted CI. Retain feature004 UI/emulator evidence with exact source dates and limits. No new application behavior is added by005. After exact private PR CI, normal merge, main push CI and verified backup, build zero-traffic production candidate and promote only using that main run's trusted evidence. Record candidate/main commit/tree, traffic and unauthenticated private-route contracts; do not mutate production fixtures.

## Complexity Tracking

No constitution violations or new framework/dependencies. This policy broadening is an explicit user decision; narrower validation and cloud omissions are reported rather than mislabeled.
