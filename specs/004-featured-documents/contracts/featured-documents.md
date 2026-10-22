# Featured Documents Endpoint Contract

**Status**: Implemented contract; final acceptance status is in [validation](../validation.md).

## GET /api/documents/featured

Require current approved effective Documents read access, independently of Overview. Return `200` `{documentIds:string[]}` with the current eligible visible subset in stored order; absent field yields `[]`. Private/no-store. Omit hidden/raw config, names/content and encryption details. Eligibility requires existing non-deleted same-project documents, effective folder access, valid ancestry, no encryption anywhere in ancestry, and no reserved Factura/Compras roots/descendants. Unlock state is irrelevant. GET never writes/prunes.

## PATCH /api/documents/featured

Require approved admin/editor Documents management; deny viewer/read-only contexts. Payload `{addIds:string[],removeIds:string[]}` is incremental, never a replacement or client project selector. Arrays may be empty; accept stable document IDs matching `^[A-Za-z0-9_-]{1,200}$` (current application ID format, no path separators), stable-deduplicate, bound each to 30 unique IDs, reject overlap/malformed shape with generic `400`.

Validate all submitted IDs, including removals, against current project/document/folder state. Missing/deleted/foreign/inaccessible/encrypted/reserved targets produce generic `403` and no write/pruning. Do not leak identities.

Transaction reads latest project CONFIG and relevant document/folder snapshots before writes. First distinguish structurally unavailable stored references from valid ordinary references hidden only by actor grants. Prune only unavailable references on an otherwise accepted operation; preserve all valid hidden references and unrelated concurrent changes. Remove authorized requested IDs, append new unique IDs in supplied order, and keep remaining stored order. Already-present adds/eligible already-absent removals are no-ops. Result over 30 yields generic `409` with no partial write/cleanup. Merge only `featuredDocumentIds`.

Success returns `200` `{documentIds:string[]}`, current caller-visible projection. Preserve generic authentication/access failure conventions (`401` where applicable, otherwise `403`). Persistence failure must not appear as saved. No raw hidden IDs/content/count breakdown in errors. Reference cleanup never moves/deletes files.

## Client/Demo

At dialog opening, snapshot only saved IDs currently represented by eligible candidate file records. Compute additions/removals from that visible baseline; saved API IDs absent from a stale file payload must not become implicit removals. The hook save operation accepts the delta and returns a success boolean; real success adopts response IDs, while demo applies the delta to parent-owned IDs. Failure retains saved view and draft. Existing IDs are not reordered. Demo applies local parent-owned ordered state with no endpoints. Release retains backup, exact-source verification, provenance and unchanged budget controls. The author's separate [005 policy amendment](../../005-optional-cloud-qa/spec.md) makes cloud QA optional for every change and requires explicit approval for each run; offer it only for substantial validation need or a user request.

Featured rows are read-only file entry points: hide ordinary file drag, folder-change, description, quote-toggle and delete controls. Keep preview, download and full-folder-path navigation. Explicit Unfiled/folder views retain their existing operations.
