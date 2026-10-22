# Consistent English and Spanish demo

> Historical private-development record. Its commit IDs are metadata only; the original commit objects and review evidence are retained privately and are not part of this public snapshot. See [snapshot provenance](../../docs/portfolio/snapshot.md).

**Created**: 2026-10-13. **Status**: In progress.

## User problem and outcomes

The deployed demo changes interface labels while leaving sample record content in mixed English
and Spanish. A visitor should see coherent sample content in the selected language, including
overview/activity, project chooser, budget/editor, purchases/expenses, folders/documents,
aesthetics, approvals, schedule/countdowns, decisions and site progress.

### Visitor stories

1. P1: Open the English demo and explore each public section without Spanish seed descriptions.
2. P1: Switch to Spanish and see localized seed descriptions, labels and options.
3. P1: Edit a demo amount or description, switch language, and keep that custom edit.

## Requirements

- FR-001: Demo interface labels and predefined sample descriptions use the selected EN/ES language.
- FR-002: Language selection applies from entry and while navigating/switching language, without resetting sample records, dates, IDs, saved edits, deletion, selection or numerical values.
- FR-003: Real project records, user-entered text, filenames/URLs/IDs used for lookup and permissions stay unchanged; localized demo display is not a production-data migration.
- FR-004: Meaningful unit/browser regressions cover both languages, switching with edited synthetic records and preservation of private text. Record measured results and omissions.
- FR-005: Follow-up release preserves verified backup, clean source, zero-traffic candidate, complete source-specific CI, normal merge and exact-tree promotion. The author explicitly authorized optional cloud QA for presentation changes on 2026-10-13. CI-only promotion must reject server, permission, security and unreviewed operational changes; the existing cloud QA path remains available and required for those changes. Keep the approved QA budget unchanged and claim no new cloud/model regression evidence.

## Clarifications

Translate predefined fictional content and interface labels, not proper names, currency identifiers,
arbitrary user text or real documents. Stable enum values remain canonical; their visible labels
are translated. Existing download aliases and canonical workbook worksheet/metadata identifiers remain intact.
Additional EN/ES synthetic download aliases translate visible content and status literals, preserving
UUIDs, values and calculation semantics. Private filenames and URLs are never rewritten.
The demo assistant stays disabled. Old 001/002 delivery records remain unchanged.

### Author-approved release choice

After all 222 local browser cases passed, the author declined additional paid QA and explicitly
approved cloud QA being optional for presentation changes. This amends the active delivery's
release requirement; completed 001/002 records remain unchanged. The bounded alternative uses
trusted complete CI on main for the normal merge's exact tree, source classification, verified
backup and candidate checks. Server/access/security changes remain outside this alternative.
