# Access and encrypted document boundaries

Project membership, section access and folder grants are evaluated on the server through
[auth](../../lib/auth.ts) and [folder rules](../../lib/folders.ts). Personal workspaces and drafts
retain ownership boundaries; notes are project-scoped and require Notes permission. Platform-owner analytics does not follow from project administration.

[Temporary file links](../file-sharing.md) explicitly grant anonymous download of one ordinary
file for up to seven days. Only independently authorized administrators/editors can create them.
Every download rechecks expiration, the creator's current project/section/folder access, source
availability and vault exclusions. The token is stored only as a hash, and delivery is pinned
to the original storage generation with attachment/no-store protection.

## Encrypted folders

[The vault service](../../lib/folder-vault.ts) requires grant authority and an active password
unlock. Ordinary members need an explicit vault grant; approved project administrators have
implicit grant authority but still need the password unlock. Content and file metadata use [AES-256-GCM envelope encryption](../../lib/folder-vault-crypto.ts)
with randomized nonces and authenticated context binding. Stored objects use opaque names.

Unlock sessions are bound to the user, authenticated session, project, folder and permission version.
Cookies are HttpOnly, SameSite=Strict and Secure in production; unlocks expire after 15 minutes.
Permission changes and password resets invalidate previous unlock versions.

Current code includes an administrator password-reset path backed by a server recovery wrapper.
This protects stored content and access boundaries; it is **not end-to-end encryption against
the server**. Folder names and operational metadata remain visible under their access rules.
Previous exports, backups and plaintext copies are not retroactively rewritten.

Encrypted sources remain outside document extraction/search, assistant and quotation references,
and distribution imports. This exclusion also applies to authorized administrators.

## Reviewable evidence

[Crypto tests](../../tests/folder-vault-crypto.test.ts) exercise actual Node cryptography.
[Vault access tests](../../tests/folder-vault.test.ts) and [document-route tests](../../tests/vault-documents-route.test.ts)
use mocked persistence to exercise grants, unlocks, races, expiry and no-store responses.
[Exclusion tests](../../tests/encrypted-document-exclusions.test.ts) exercise plaintext integration denial.
These are focused regressions rather than an independent security audit.

[User guide](../encrypted-folders.md) · [Reconstructed case](../development/cases/encrypted-documents.md)
 · [Security reporting](../../SECURITY.md)
