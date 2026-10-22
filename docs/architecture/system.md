# System design

House Planner is a Next.js App Router application. Client workspaces provide project navigation,
budget editing, file previews, design galleries and field capture. Route handlers own authentication,
authorization, persistence and cloud integration.

## Boundaries and authority

| Boundary | Implementation | Responsibility |
|---|---|---|
| Identity and active workspace | [auth](../../lib/auth.ts), [projects](../../lib/project.ts) | Signed sessions, memberships, personal/shared isolation |
| Documents | [folders](../../lib/folders.ts), [file routes](../../app/api/files/route.ts) | Folder grants, private storage, previews and moves |
| Budget | [workbook conversion](../../lib/workbook.ts), [store](../../lib/workbook-store.ts) | XLSX authority, caches, versions and draft objects |
| Assistant | [service](../../lib/assistant-service.ts), [tool validation](../../lib/assistant.ts) | Grounding, permitted context and validated proposals |
| Protected folders | [vault](../../lib/folder-vault.ts), [crypto](../../lib/folder-vault-crypto.ts) | Separate grants, temporary unlock and encrypted content |
| Operation | [release-source](../../scripts/release-source.mjs), [deployment](../../scripts/deploy-gcp.ps1) | Clean source, exact commit/tree and release evidence |

The official XLSX holds workbook-entered planned and paid amounts. Firestore contains validated
budget-line caches and independent expense records. Binary workbooks, document objects, draft
snapshots and previews live in private Cloud Storage. See [workbooks](workbooks.md) for the lifecycle.

## Decisions and trade-offs

- **Server checks for every access path.** Canonical URLs are navigation, not grants. Read-link
  tokens pass through their own server-side grant resolution. Hiding a section is never sufficient.
- **Recoverable snapshots over shared in-place editing.** Storage and revision management cost
  more than a simple table, but preserve private drafts and permit conflict detection.
- **Typed model tools over unrestricted actions.** The server controls context and proposal targets;
  a model response cannot bypass review. This improves control without guaranteeing factual accuracy.
- **Prepared 3D data over automatic conversion.** Import is explicit and reviewed. Uploaded plans
  do not automatically trigger a model conversion or paid job.

## Repository map

`app/` contains pages, route handlers and workspaces; `lib/` contains domain rules and cloud services;
`tests/` contains unit and route/component tests; `e2e/` contains browser and guarded QA scenarios;
`scripts/` contains validation and operator tooling. Docs and specs explain those boundaries rather
than introducing a separate application architecture.

[AI detail](assistant.md) · [Security detail](security.md) · [Testing evidence](../development/testing.md)
