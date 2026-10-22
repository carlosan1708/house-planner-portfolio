# Case: versioned workbook drafts and administrator approval

**Status**: Reconstructed design, 2026-10-13. Implementation predates these artifacts.

## Problem and requirements

Members need editable working copies without overwriting another draft or bypassing the official
workbook's publication authority. Excel formulas and row identity must survive supported changes.

| ID | Current requirement | Implementation | Test evidence |
|---|---|---|---|
| WB-01 | Preserve stable budget-line mapping and supported formulas | [workbook](../../../lib/workbook.ts) | [synthetic workbook regressions](../../../tests/workbook.test.ts) |
| WB-02 | Reject stale saves and frozen draft mutation | [draft rules](../../../lib/drafts.ts), [route](../../../app/api/workbook/drafts/route.ts) | [draft concurrency](../../../tests/permissions-navigation-drafts.test.ts) |
| WB-03 | Separate editor submission from admin publication | [draft route](../../../app/api/workbook/drafts/route.ts), [approval route](../../../app/api/approvals/route.ts) | [draft UI workflow](../../../tests/budget-draft-workflow.test.tsx) |
| WB-04 | Distinguish edits from recalculated formula results | [approval diff](../../../lib/approval-diff.ts) | [diff tests](../../../tests/approval-diff.test.ts) |
| WB-05 | Preserve recoverable official versions and conflict checks | [workbook store](../../../lib/workbook-store.ts) | [publication base rules](../../../tests/permissions-navigation-drafts.test.ts) |

## Reconstructed decision: immutable snapshots and guarded promotion

**Chosen approach**: Store private versioned snapshots, use optimistic draft revisions, freeze
submitted edits, and promote a candidate XLSX through the administrator workflow.

**Alternative**: Mutate the shared workbook immediately whenever a browser saves.
That would simplify storage, but remove reviewable working copies and reliable stale-save denial.

**Trade-off**: More snapshot objects, revisions and cache coordination. Concurrent changes become
explicit conflicts rather than automatic merges. Unsupported XLSX features can prevent editing
while preserving the original download.

## Acceptance scenarios and limits

- Saving an older draft revision fails instead of silently overwriting new work.
- Submitted drafts cannot be edited through the editing save path.
- An editor submits for approval; an administrator can publish directly.
- The diff separates changed cells from values recomputed by formulas.

Direct publication checks both base plan and actuals revisions. The approval transaction checks
the current plan revision but does not explicitly perform the same loaded-actuals comparison.
Do not infer identical concurrency coverage. Rule/UI tests do not constitute a full live
approval-route race test or Google Sheets integration session.

[Architecture detail](../../architecture/workbooks.md)
