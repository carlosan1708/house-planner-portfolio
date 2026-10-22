# Data Model: Featured documents

> Historical private-development record. Its commit IDs are metadata only; the original commit objects and review evidence are retained privately and are not part of this public snapshot. See [snapshot provenance](../../docs/portfolio/snapshot.md).

## Project Selection

Existing CONFIG document: `firestore.collection(CONFIG).doc(projectConfigDoc(actor.projectId))`.

- `featuredDocumentIds: string[]`: ordered unique document IDs; absent means `[]`; maximum **30 valid globally stored references**, including ordinary selections hidden by the caller's folder grants.
- Merge only this field; other CONFIG fields and actual files/folders remain unchanged.
- GET filters without writing. A successfully accepted PATCH prunes structurally unavailable stored references (missing/deleted/foreign/encrypted/reserved/orphaned) before cap enforcement. Valid ordinary references hidden only by grants survive. An invalid submitted ID rejects the entire operation before pruning.

## Existing Records and Eligibility

Use document ID, `projectId`, `folderId`, deletion and encryption metadata, plus current folder ancestry/grants. No filename/content/URL is duplicated into configuration. Reject foreign/missing/deleted targets, invalid/missing/cyclic ancestry, encrypted documents or any encrypted ancestor even unlocked, and reserved Factura/Compras roots/descendants. Caller invisibility alone is not structural unavailability.

## Input/Output

[Endpoint contract](contracts/featured-documents.md): GET/PATCH success `{documentIds:string[]}` exposes only current visible eligible stored-order IDs. PATCH `{addIds:string[],removeIds:string[]}` arrays are stable-deduplicated and bounded to 30 unique IDs each; reject malformed IDs and add/remove overlap. Caller/project derives from authorization, not client payload. Every submitted ID, including removals, is currently authorized.

## Transitions

1. Read: stored IDs -> visible eligible projection; no write.
2. Open: saved IDs intersected with currently eligible candidate file records -> separate opening baseline/checked draft; missing stale file records are not implied removals.
3. Cancel: discard draft; saved selection unchanged.
4. Save: diff against visible opening baseline -> current actor/target validation -> transaction reads latest config/document/folder state -> prune structurally unavailable references -> remove permitted requested IDs -> append unique new IDs in request order -> enforce 30 -> merge feature field.
5. Failure: no partial selection or cleanup write; saved state unchanged, draft/error retryable.
6. Success: accept current visible ordered response and close dialog.
7. Demo: same ordering/limit semantics in parent-owned local session state; no endpoint call, no language/navigation reset.

Transaction retries evaluate latest config and current target/folder snapshots. Unrelated edits and valid hidden references survive. Tests must distinguish structurally invalid versus merely inaccessible references and prove cleanup does not occur after rejected input.
