---
name: house-planner-access-review
description: "Review or implement House Planner authorization changes across API routes, project\
  \ ownership, read links, folders, encrypted documents and platform analytics. Use\
  \ for access or data-isolation work, not a generic audit of unrelated UI."
---

# House Planner access review

Trace one affected operation from request identity to its stored record and response. Read the actual helpers in lib/auth.ts, lib/access-links.ts and lib/project.ts before changing guards; supplement with the feature modules actually used. UI visibility is not an authorization check.

Check active membership, section permission, role where the operation requires it, and ownership of the loaded record under the selected project. Validate every referenced parent, purchase, document or folder belongs to the same permitted project. Query parameters and canonical links carry selection, not access grants.

## Apply the relevant boundary

- Platform usage analytics uses requirePlatformOwner(); project administrator status is not platform ownership.
- Read links remain read-only, including paths that an independently granted viewer may otherwise use. Preserve intentional viewer actions such as per-user reminder acknowledgement; do not replace action-specific rules with a blanket role assumption.
- Anonymous direct read access and signed-in independent grants are separate paths. Revocation review includes membership, session, invitation and existing link redemption, not only a hidden directory row.
- Folder scope must be enforced for descendants, moves, mixed selections, download/preview and aggregate counts. Inspect canAccessFolder and the feature's tree resolution; filtering only the visible list can leak counts or content through another route.
- For encrypted Documents, read lib/folder-vault.ts, lib/vault-documents.ts and docs/encrypted-folders.md. A document grant does not replace vault grant and unlock requirements. Preserve inherited vault boundaries and exclusions from fresh AI extraction/index retrieval. Historical assistant messages have their own revalidation limits.
- Preserve signed activity and stored historical edits when a user is deactivated. Use lib/project-authors.ts read-time display aliases; never hard-delete authorship to hide a removed identity.

Use synthetic negative cases for cross-project IDs, denied section/folder scope, read links, deactivated users and stale access paths relevant to the operation. Include a successful independently permitted identity so denial tests cannot pass merely because every request fails. Verify failure leaves data unchanged. Ask before any full regression or its automatic trigger as specified in AGENTS.md; focused contract checks do not prove a complete security audit or live cloud integration.

Current CI policy: static review, unit tests and build are mandatory; bounded applicable Playwright is automatic. Full browser/emulator regression is optional and requires a user request/approval. Standard CI is authorized with ordinary work; cloud QA keeps its separate session approval.
