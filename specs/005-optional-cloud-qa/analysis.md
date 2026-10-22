# Preimplementation Consistency Analysis

> Historical private-development record. Its commit IDs are metadata only; the original commit objects and review evidence are retained privately and are not part of this public snapshot. See [snapshot provenance](../../docs/portfolio/snapshot.md).

Reviewed 2026-10-14 after spec, constitution1.1.0, plan and tasks, before release-code changes. Spec Kit1.2.0 Codex analysis is read-only; this file records the resulting report.

| Finding | Severity | Resolution |
| --- | --- | --- |
| Previous policy mandated cloud for server/security changes | Critical under previous constitution | Author explicitly amended constitution separately to1.1.0 before analysis;005 records the changed rule. |
| A CLI flag would not prove human consent | Medium | Conversation approval remains an agent/operator prerequisite; no flag is treated as trusted approval evidence. |
| CI failure could implicitly redirect to paid cloud validation | High | All active messages and instructions stop for corrected CI; no automatic cloud invocation/fallback. |
| Earlier feature evidence might be relabeled as final policy CI | High |004 measured application evidence stays source-specific;005 gets fresh policy tests/CI and deployment evidence. |

## Coverage

FR-001:T003/T006/T008; FR-002:T003/T008/T009; FR-003:T003/T008; FR-004:T004/T006/T009; FR-005:T001/T005/T008; FR-006:T001/T005/T008; FR-007:T002/T004/T005/T006/T008/T009; FR-008:T001/T007/T008. Eight requirements, nine tasks,100% requirement coverage, zero unmapped tasks and zero unresolved critical findings. No clarification markers remain. Code and documentation owners have disjoint files. Implementation may proceed; runtime acceptance remains unmeasured at this stage.

## External Verification Finding

After source freeze, exactCI38636346795 found a high-severity test-readiness gap: `signIn` returns on`/api/me`200 while `AuthGateway.establishSession` still performs its explicit browser reload. A subsequent Notes goto is interrupted by the original Overview navigation. The existing server mutation/denial assertions had passed up to that point. Resolution is recorded before editing asT010: await rendered authenticated workspace/route and validate the expected six identities without retrying, sleeping or weakening product assertions. This requirement coverage remains FR-002/FR-005/FR-007. Final CI must be fresh for the actual amended source.

## Concurrent Main Review

After completeCI38639143579 passed atce11033, fresh main inspection found independently mergedPR48 at0e96e2de. Its budget quote changes touch separate application files plusREADME; no candidate was built before detecting the changed baseline. T011 records integration before editing. Resolve README semantically, preserve both approved features, rerun complete checks on the combined source, and require the currently deployed production tree to equal the eventual normal-merge first parent. No cloud QA or baseline bypass is introduced.

## Integrated Local Browser Finding

The first combined-source run observed231 browser passes and one missing dialog after a native touch pan. The trace shows the exact notes save response and actual scroll movement; continued kinetic motion is a readiness hypothesis, not a proved application defect. T012 records a native scrollend barrier before the next tap, preserving the complete assertions and prohibiting delay/retry/timeout workarounds. The concurrent emulator startup lock produced zero permission cases and requires a separate serial run. New complete local and source-specific CI evidence must close these findings.
