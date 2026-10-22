# Encrypted document folders

Administrators can create a protected root folder through Documents. A member must have project
Documents access, the applicable folder access, an explicit vault grant and a current password
unlock. Ordinary all-folder access does not grant vault access. Approved project administrators
have implicit vault grant authority and still need a password unlock to read files.

## Password and session behavior

Passwords are validated by the server. Unlocks last 15 minutes and are tied to the authenticated
account/session, project, folder and vault permission version. The browser receives an HttpOnly,
SameSite=Strict cookie, Secure in production. Permission changes, sign-in changes, logout and a
password reset invalidate prior sessions. Unlock attempts are rate-limited.

Current code supports administrator password reset through a server recovery wrapper. The reset
keeps the data key and existing grants, changes the password wrapper and increments the vault
version. This is server-readable encryption at rest, not E2EE or a password unrecoverable by the
authorized server operator.

## Protected content and operations

File content, names, type, description and related sealed metadata use contextual AES-256-GCM.
Storage objects have opaque names. Folder names and necessary operational metadata remain visible
under the folder access rules. Decrypted thumbnails are generated in memory; protected responses
use private no-store caching.

Files can be uploaded into an unlocked vault and moved within its subtree. Moving a normal file
into it encrypts content/metadata and removes plaintext indexes and the previous object. Revision
preconditions guard concurrent access changes; incomplete cleanup keeps the affected file unavailable
until retry succeeds. Historical exports or prior backups are not retroactively changed.

Moves across vault boundaries are restricted. Removing a vault requires respecting retained,
recoverable files so its keys are not discarded while content still depends on them.

## AI and other integrations

Encrypted files are excluded from assistant indexing/search, quotation references and 3D source
imports. Unlocking a vault does not authorize plaintext AI integration. Mobile capture uses normal
folders. See [the security design](architecture/security.md) and
[reconstructed case](development/cases/encrypted-documents.md) for evidence and limits.
