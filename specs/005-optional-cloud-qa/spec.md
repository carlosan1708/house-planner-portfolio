# Feature Specification: Optional cloud QA with author control

> Historical private-development record. Its commit IDs are metadata only; the original commit objects and review evidence are retained privately and are not part of this public snapshot. See [snapshot provenance](../../docs/portfolio/snapshot.md).

**Branch**: `codex/featured-documents` | **Created**: 2026-10-14 | **Status**: Specified before implementation
**Input**: The author requests changes wherever needed: cloud QA must always be optional, require asking and approval each time, and be offered only for a substantial reason or at the author's request.

## User Scenarios & Testing

### US1 - Release with complete CI (P1)
As the author, I can release a tested server or client change without purchasing an isolated cloud QA run.
**Independent test**: Complete trusted CI accepts a server/API/security diff with exact reviewed workflow, normal main merge, unchanged deployed baseline and matching candidate tree; incomplete CI, stale evidence, wrong source or skipped permissions remain denied.
1. Given a tested server change, when normal merge CI passes, then it can use CI promotion without cloud QA.
2. Given failed or stale CI, when promotion is attempted, then it stops for repaired evidence and never starts cloud QA.

### US2 - Choose every cloud session (P1)
As the author, I approve or decline each specifically proposed cloud QA session before any cloud QA operation or cost reservation.
**Independent test**: Active agent/operator instructions explicitly require per-session approval for cloud setup/build/regression, prohibit inference from generic deployment/testing requests, and keep local emulators the default.
1. Given no approval, when an agent prepares a release, then it uses local/CI validation and does not provision/build/reserve/run cloud QA.
2. Given a substantial uncertainty that local tests cannot resolve, when a cloud session is offered, then its reason, scope and estimated cost are explained before approval.
3. Given a declined offer, when CI is otherwise complete, then release can continue through CI without resetting or increasing the QA budget.

### US3 - Keep evidence and safeguards (P2)
As a reviewer, I can distinguish CI acceptance from optional cloud/model evidence without losing backup, authorization or provenance checks.
**Independent test**: Release reports name exact source and selected validation mode, preserve trusted workflow/normal merge/current baseline checks, and disclose cloud/live-service omissions.

## Edge Cases

- No request or an exhausted QA allowance: no cloud work, reservation reset or budget increase.
- Prior approval for another session: do not reuse it; cleanup belongs to the approved session and completes without asking again.
- Malformed/duplicate/partial source inventory, symlink or gitlink: fail closed; do not redirect to cloud.
- Changed CI workflow or advanced main/deployed baseline: repair reviewed source/evidence rather than infer approval.
- Existing cloud evidence: retain its independent source/suite/cleanup checks only when the operator explicitly chooses cloud mode.
- General merge/deploy/test authorization: authorizes that stated release work, never optional cloud QA spending.

## Requirements

### Functional Requirements

- **FR-001**: Complete trusted CI MUST support every category of ordinary repository code change, including server, permissions, security and operational code.
- **FR-002**: CI promotion MUST retain private repository identity, pinned complete workflow, recent successful main push, normal two-parent merge of the exact candidate, exact candidate/main tree, live main reference and current production baseline.
- **FR-003**: Source inventory MUST reject missing/duplicate/malformed paths, invalid A/M/D mode/blob transitions and non-regular entries without silently accepting partial evidence.
- **FR-004**: Production tooling MUST default to CI, require the selected mode's trusted run ID for promotion, prohibit mixed evidence, and never automatically invoke cloud QA.
- **FR-005**: Active agent/operator instructions MUST require explicit human approval for each scoped cloud QA session before cloud operations/reservations, without treating flags as proof of consent.
- **FR-006**: Cloud QA MUST be offered only at the author's request or for a specific substantial uncertainty; proposals MUST explain need, scope and estimated cost, and declined cloud QA MUST remain optional.
- **FR-007**: Backup, zero-traffic candidate, exact-source/traffic verification, boundary tests and existing QA limits/ledger/cleanup MUST remain intact; reports MUST disclose omitted live cloud/model/integration checks.
- **FR-008**: The amendment MUST have its own Spec Kit specification, plan, tasks, consistency review and measured evidence; completed 001-003 records MUST remain unchanged.

### Key Entities

- Release evidence: trusted CI run, candidate commit/tree, normal main merge, currently deployed tree and regular-file inventory.
- Cloud session approval: human instruction with scope/reason/cost, recorded before optional cloud work; command arguments cannot establish its authenticity.

## Success Criteria

- **SC-001**: All release verifier rejection cases remain passing and server/security/operational change cases pass with complete exact-source CI.
- **SC-002**: No active instruction states a change category mandates cloud QA; historical snapshots retain their dated context.
- **SC-003**: This delivery consumes zero QA cloud builds/regressions/reservations and keeps USD5.50 target, USD5.25 cutoff and ten-build allowance unchanged.
- **SC-004**: Final CI and promotion are source-specific; the final report states actual deployment status and omitted checks.

## Clarifications and Scope

The author's 2026-10-14 instruction supplies the policy decision directly. No further clarification or cloud approval is needed to implement it. Earlier merge/deploy authorization continues under this amended policy. The repository remains private; no production-data repair or profile edit is introduced. Optional cloud QA and the production candidate/backup are different operations. Existing cloud entrypoints remain manual operator tools; agent instructions enforce the conversation prerequisite without inventing an approval boolean as trusted evidence.
