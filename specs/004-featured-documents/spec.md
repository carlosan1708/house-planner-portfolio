# Feature Specification: Featured documents on the Documents landing page

> Historical private-development record. Its commit IDs are metadata only; the original commit objects and review evidence are retained privately and are not part of this public snapshot. See [snapshot provenance](../../docs/portfolio/snapshot.md).

**Feature Branch**: `codex/featured-documents`

**Created**: 2026-10-13

**Status**: Application development accepted with measured CI/manual evidence and disclosed limits; production release separate.

**Input**: The author confirmed a manually curated collection on the Documents landing page, while retaining folders and a separate Unfiled view.

## User Scenarios & Testing

### User Story 1 - Find the project's featured documents (Priority: P1)

A project member opens Documents and immediately sees the documents the project's authorized editors selected as useful entry points. These documents can live in different ordinary folders. The folder grid remains available, and Unfiled is an explicit, separate view.

**Why this priority**: Documents becomes a useful starting point without requiring visitors to browse every folder or changing where files belong.

**Independent Test**: With a synthetic project containing a saved collection, an authorized viewer opens Documents, reads the visible featured documents in saved order, enters a folder, and switches to Unfiled.

**Acceptance Scenarios**:

1. **Given** a saved collection of accessible documents in several folders, **When** a member opens the Documents root, **Then** Featured documents is the default collection, its documents follow the saved order, and the folder grid remains available.
2. **Given** documents that have no folder, **When** a member opens Featured documents, **Then** those documents appear only if explicitly selected; **When** the member opens Unfiled, **Then** the existing unfiled collection is available separately.
3. **Given** no saved selection, **When** a member opens Documents, **Then** Featured documents shows a meaningful empty state without automatically selecting documents; an authorized editor can open the selection dialog.
4. **Given** a featured document becomes inaccessible, deleted, missing, encrypted, or part of a reserved expense folder, **When** the collection is read again, **Then** that document is absent and its hidden identity and content are not disclosed.

### User Story 2 - Curate without moving documents (Priority: P1)

A project administrator or editor with Documents management permission selects up to 30 eligible documents from across the project's accessible folders. The application selection dialog supports search, full folder paths, checkboxes, Save, and Cancel. Featuring a document changes its inclusion in the collection, not the document itself.

**Why this priority**: Manual selection lets the project owner control the starting collection while preserving file organization and access rules.

**Independent Test**: An authorized editor searches synthetic documents, selects documents in different folders, saves, and reopens the collection. A separate run cancels changes and another simulates a failed save.

**Acceptance Scenarios**:

1. **Given** accessible plain documents in different ordinary folders, **When** an authorized editor opens the selection dialog, **Then** eligible documents can be searched and selected with full folder paths and clear checked states.
2. **Given** a valid selection change within the project-wide limit, **When** the editor saves, **Then** existing remaining selections keep their order and new selections are appended in the order selected; filenames, folders, file content, and permissions stay unchanged.
3. **Given** an unsaved selection draft, **When** the editor cancels, **Then** the saved collection remains unchanged.
4. **Given** a failed save or permissions revoked before saving, **When** the save is rejected, **Then** no part of the change is saved, the existing collection remains unchanged, and the dialog retains the draft with a useful error and retry opportunity.
5. **Given** a viewer or a member without Documents management permission, **When** that person uses Documents, **Then** available read permissions apply and curation is unavailable; attempting to save a selection is denied.
6. **Given** a document already stored in a folder, **When** it is dragged over the Featured documents root, **Then** the root does not move it into Unfiled. Explicit Unfiled and ordinary folder views retain their existing upload, drop, and move behavior.

### User Story 3 - Preserve selections across editors and demo navigation (Priority: P2)

Restricted editors can change the documents they are allowed to manage without discarding selections they cannot see. Independent changes made by other editors survive. Demo visitors can try the collection locally and switch language or sections without losing their selection.

**Why this priority**: A shared collection must respect differing folder access and concurrent editing, while the public demo must remain isolated from private projects.

**Independent Test**: Two synthetic editors with different folder grants make unrelated selection changes; both changes remain, inaccessible selections stay stored but hidden, and the overall limit is enforced. In the demo, a visitor changes selections, switches English and Spanish, and navigates away and back.

**Acceptance Scenarios**:

1. **Given** stored selections hidden from a restricted editor, **When** that editor adds or removes visible eligible selections, **Then** the hidden selections remain stored without exposing their identities.
2. **Given** two editors concurrently add different eligible documents, **When** both changes succeed, **Then** both additions remain; saving one editor's change does not replace the other's unrelated selections.
3. **Given** 30 stored selections, including selections hidden from the caller, **When** an editor tries to add another document without freeing an eligible selection, **Then** the whole change is rejected with a limit explanation that does not reveal hidden document identities.
4. **Given** a demo visitor's saved local selection or open selection draft, **When** the visitor switches language, **Then** the selection and draft remain intact; **When** the visitor navigates away and back, **Then** the saved selection remains available in that demo session.
5. **Given** a demo selection change, **When** the visitor saves or cancels it, **Then** no private project is read or changed and no remote selection is persisted.

### Edge Cases

- An unset or empty collection is intentional; ordinary Unfiled documents are not a fallback for Featured documents.
- A stored selection may become missing, deleted, moved into an excluded folder, orphaned, or inaccessible. Reads hide it without writing. An accepted save removes structurally unavailable references, while valid ordinary documents hidden only by folder grants remain stored.
- Folder names can repeat at different depths. Full folder paths distinguish candidate documents without revealing inaccessible folder content.
- Encrypted files and files beneath any encrypted ancestor are excluded even when an administrator has unlocked the vault.
- Documents in the reserved Factura and Compras expense roots or their descendants are excluded.
- A member may lose project, Documents, or folder permission between opening the dialog and saving. The attempted change must fail completely and retain the local draft.
- Duplicate selections and repeated save attempts must not create duplicate featured entries or reorder existing ones.
- Concurrent additions can reach the global 30-document limit. A rejected change must not partially remove or add documents.
- The root Featured collection must not reuse a drop action that would move an existing file to no folder; explicitly visiting Unfiled retains that established action.
- Switching language must not reset checked candidates, overwrite custom document names, or modify private document text.

## Requirements

### Functional Requirements

- **FR-001**: Documents MUST default at its root to a manually curated Featured documents collection, retain the folder grid, and provide an explicit separate Unfiled view. Overview MUST remain outside this feature's scope. An unset selection MUST produce an empty featured collection rather than automatic selections.
- **FR-002**: Authorized curators MUST be able to feature existing eligible documents from any accessible ordinary folder in the same project. Curation MUST NOT move, rename, duplicate, upload, modify, or change permissions on those documents. The Featured root MUST NOT move existing files into Unfiled through drop behavior; explicit Unfiled and ordinary folder operations MUST retain their existing behavior.
- **FR-003**: The application's selection dialog MUST provide search, full folder paths, checked selection states, Save, and Cancel. Cancel MUST preserve the saved collection. A failed save MUST leave the saved collection unchanged, preserve the draft, and explain how the user can retry or correct the selection.
- **FR-004**: The selection MUST be saved separately for each project as an ordered collection of at most 30 unique valid document references. Existing remaining selections MUST retain their saved order; additions MUST be appended in selection order. The limit MUST count valid ordinary project selections hidden from the caller by folder grants. Reads MUST NOT change stored references; an otherwise accepted save MAY remove structurally unavailable references before enforcing the limit, as described in FR-005.
- **FR-005**: A save MUST apply the caller's requested additions and removals together to the latest collection, without replacing the entire collection. It MUST preserve valid ordinary project selections hidden from that caller by folder grants and unrelated concurrent edits. An otherwise accepted save MUST remove structurally unavailable saved references (missing, deleted, foreign-project, encrypted, reserved-expense, or orphaned-folder references) before enforcing the global limit. All submitted IDs, including removals, MUST be validated first; an invalid submitted ID rejects the whole save without any write or cleanup. Cleanup MUST NOT move or delete actual files. The save MUST either apply all accepted selection changes and reference cleanup or none.
- **FR-006**: Reading the collection MUST return only the currently eligible, visible selections in stored order, without disclosing hidden identities or content. Documents access MUST be sufficient for this feature independently of Overview access; all existing identity, active membership, section, and folder access rules MUST continue to apply.
- **FR-007**: Only project administrators and editors with effective Documents management permission MAY change the collection. Viewers and other read-only access contexts MAY read only within their existing effective grants and MUST NOT curate. Every submitted change MUST be authorized at save time, rather than trusting the dialog's earlier candidate list.
- **FR-008**: Selection changes MUST reject references belonging to another project, inaccessible folders, missing or deleted documents, encrypted documents, documents beneath encrypted ancestors, and documents in the reserved Factura or Compras expense roots or their descendants. Unlocking encryption MUST NOT make a document eligible. Rejection MUST be complete and MUST NOT expose unauthorized document details.
- **FR-009**: Demo selection MUST remain local to the demo session and MUST NOT read or write private or remote project selections. Saved demo selection MUST survive section navigation; saved selection and an open selection draft MUST survive English/Spanish switching. Interface localization MUST preserve custom text and private document names, identifiers, and content.
- **FR-010**: Validation MUST cover the primary journeys, permission boundaries, hidden selection preservation, unrelated concurrent edits, the global limit, save cancellation and failure, excluded folders/encryption, root drop behavior, existing Unfiled behavior, and demo language/navigation preservation using synthetic data. Local, continuous-integration, and manual evidence MUST be recorded separately with actual results and omissions.
- **FR-011**: Delivery MUST preserve authorization, backup, source-specific verification, merge, provenance and cost controls. Per the author's 2026-10-14 amendment, cloud QA MUST be optional for every change and MUST require explicit approval for each run; it is offered only for substantial validation need or an explicit user request. The former presentation/server classification is superseded through the separate [005 policy delivery](../005-optional-cloud-qa/spec.md), not retroactively treated as prior approval. Specification or implementation MUST NOT imply paid cloud QA or production-data changes. The QA budget remains USD 5.50, with the USD 5.25 cutoff and maximum 10 QA builds. Completed specifications 001-003 MUST remain unchanged.

### Key Entities

- **Project featured collection**: An ordered, project-owned collection of up to 30 unique document references, including valid ordinary selections currently hidden by the caller's folder permissions. Structurally unavailable references are removed only by an otherwise accepted save.
- **Eligible document**: An existing, non-deleted plain document in the same project, accessible under the caller's Documents and folder grants, outside encrypted ancestry and reserved expense folders.
- **Visible featured collection**: The current caller's eligible subset of stored selections, retaining the stored order without revealing excluded references.
- **Selection draft and change**: Checked candidates and the explicit additions/removals an authorized curator intends to save; cancelling or a failed save leaves the saved collection unchanged.

## Success Criteria

### Measurable Outcomes

- **SC-001**: In all synthetic landing-page scenarios, members can open Featured documents, an ordinary folder, and the separate Unfiled view directly from Documents without using Overview.
- **SC-002**: Every successful curation scenario contains no more than 30 unique stored selections, preserves the relative order of retained selections, appends additions in the chosen order, and leaves document content, names, folders, and permissions unchanged.
- **SC-003**: All permission and exclusion scenarios reveal zero unauthorized document identities or content; all rejected saves leave the saved collection unchanged.
- **SC-004**: In all unrelated concurrent-edit and restricted-editor scenarios, valid ordinary selections hidden by folder grants and unrelated accepted changes remain stored, while reads show only documents the caller may access.
- **SC-005**: Both English and Spanish demo runs preserve saved selection through navigation and preserve saved selection and open drafts through language switching, with zero private project reads or remote selection writes.
- **SC-006**: All acceptance journeys have recorded local and continuous-integration results and a manual synthetic-data review before the feature is described as complete; absent, failed, or separately authorized external checks are explicitly identified.

## Assumptions

- Existing project membership, Documents permissions, folder grants, reserved expense folders, encryption boundaries, and ordinary document operations remain authoritative.
- Manual curation is shared per project, not a personal favorite list. Reordering existing selections is outside this feature; retention plus ordered additions defines ordering.
- Demo selection is session-local. Persistence across a fresh browser session or page reload is not required.
- A meaningful empty state, usable search, and the existing application dialog conventions are sufficient; automatic recommendations and AI-based selection are outside scope.
- The feature is specified against the current operational main baseline. Completed 001-003 records remain historical snapshots, and verification for this feature must identify its own final source.

## Clarifications

### Session 2026-10-13

- The author confirmed the collection belongs on the **Documents landing page**, not Overview.
- Featured documents is the root's default document collection. The folder grid remains, and Unfiled is a separate explicit view. Nothing is featured automatically.
- Candidates are existing accessible plain documents from any ordinary folder in the same project. Featuring a document does not relocate it or change its permissions.
- The shared limit is **30 stored selections**, including selections hidden from a restricted editor. Existing order is retained and new selections are appended in selection order.
- Saving uses one atomic incremental additions/removals change to the latest project collection; it is not a full replacement. Reads expose only currently visible eligible selections. Hidden stored selections and unrelated concurrent changes survive.
- Administrators and editors with Documents management permission can curate. Viewers can read under their current grants. Overview access is not required.
- All encrypted documents and encrypted ancestry remain excluded even when unlocked. The reserved Factura and Compras expense roots and their descendants are also excluded.
- The Featured root disables actions that would move existing documents into Unfiled. Explicit Unfiled and ordinary folder views retain their existing normal upload, drop, and move behavior.
- Demo curation is local only. Language changes and navigation preserve selection; an open selection draft also survives language changes.
- This authorization covers the feature's development. The private document behavior requires the ordinary server-change release checks; the earlier presentation-only exception does not authorize release or cloud QA for this feature. Existing budget limits remain unchanged.

### Engineering Consistency Decision 2026-10-13

An initial design could let missing or permanently excluded references consume all 30 slots indefinitely. To avoid that dead end, an otherwise accepted atomic save prunes structurally unavailable stored references before counting the limit. This is an engineering default derived from consistency review, not a new literal author approval. GET remains read-only. Valid ordinary project documents hidden only by the caller's folder grants and unrelated concurrent edits are preserved. Any invalid submitted ID, including a removal, rejects the entire operation before cleanup or writing. Only selection metadata is cleaned; no file is moved or deleted.

### Author Policy Amendment 2026-10-14

The author explicitly made cloud QA an optional choice for every change: ask and obtain approval for each run, and offer it only when a substantial validation need exists or the author requests it. This supersedes the earlier cloud-QA release classification recorded in the 2026-10-13 clarification. It does not increase the budget or authorize a cloud QA run. The operational implementation has its own [005 specification](../005-optional-cloud-qa/spec.md); feature004 acceptance records its application source independently.
