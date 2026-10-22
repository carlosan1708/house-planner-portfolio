# Research and Decisions

> Historical private-development record. Its commit IDs are metadata only; the original commit objects and review evidence are retained privately and are not part of this public snapshot. See [snapshot provenance](../../docs/portfolio/snapshot.md).

**Reviewed**: 2026-10-13 before implementation; local source/design only, no cloud calls or real-document reads.

| Decision | Rationale | Alternatives considered |
|---|---|---|
| Dedicated Documents route | Existing section authorization can be reused without Overview permission. | Overview response creates an unrelated grant dependency. |
| Transactional incremental CONFIG merge | Preserves hidden selections, unrelated concurrent additions and unrelated settings. | Visible full replacement or nontransactional write loses state. |
| Ordered unique references, global 30 cap | Keeps author-curated order and enforces a bounded project collection. | Sorting/replacement changes existing order. |
| Accepted-save structural reference cleanup | Missing/permanently excluded references otherwise consume all slots forever. Preserve valid hidden references; reject invalid submitted IDs before cleanup. | Read-side cleanup writes during reads; no cleanup creates a permanent full-list dead end. |
| Existing folder/vault helpers | Current top-level/reserved-folder and ancestry rules are authoritative; invalid ancestry fails closed. | Name-only checks miss descendants; ordinary unlocked listing includes vault content. |
| Shared picker, parent-owned demo IDs | Existing row/preview/path helpers are reusable; parent state survives section remount and locale changes. | Duplicated file APIs or locale reset effects broaden risk. |
| Local/CI separate from release | Constitution retains cloud QA for server changes. | Earlier presentation CI does not prove this new server behavior. |

## Source Review

Reviewed `app/api/files/route.ts`, `lib/auth.ts`, `lib/folders.ts`, `lib/folder-vault.ts`, `app/HousePlanner.tsx` document/navigation helpers, package scripts and local Playwright configuration. `requireTabAccess` resolves current approved permissions; `canAccessFolder` handles effective folder scope. Reserved Factura/Compras roots are identified by existing helpers. `vaultRootFolder` walks ancestors and fails invalid hierarchy; this feature must exclude even unlocked vault records, unlike ordinary file access.

Installed Next route-handler guide confirms route.ts GET/PATCH support; implementers must also read their relevant installed guide before code. No remaining design clarification is needed. The structural cleanup rule is a documented engineering default, not a literal author approval. Contracts are in [plan](plan.md) and [endpoint contract](contracts/featured-documents.md); measured execution is in [validation](validation.md#completed-application-checks).

## Later Policy Amendment

The research table is the 2026-10-13 design record. Its mandatory server-cloud-QA classification was superseded by the author's 2026-10-14 [005 amendment](../005-optional-cloud-qa/spec.md). Cloud QA now requires explicit per-run approval and is optional for all changes; offer it only for substantial validation need or a user request. This does not retroactively authorize a run or turn local/application CI into evidence for later policy code or release.
