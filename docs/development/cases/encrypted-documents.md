# Case: encrypted folders across document and AI paths

**Status**: Reconstructed design, 2026-10-13. Implementation predates these artifacts.

## Problem and requirements

Ordinary Documents permission must not unlock protected files. Content must remain sealed at rest,
and every download, preview, indexing and AI path must respect the encrypted boundary.

| ID | Current requirement | Implementation | Test evidence |
|---|---|---|---|
| ENC-01 | Require a separate grant and password session | [vaultAccess / hasVaultGrant](../../../lib/folder-vault.ts) | [grant and session tests](../../../tests/folder-vault.test.ts) |
| ENC-02 | Bind randomized encryption to object context | [crypto](../../../lib/folder-vault-crypto.ts) | [actual crypto tests](../../../tests/folder-vault-crypto.test.ts) |
| ENC-03 | Recheck expiry, permission version and authenticated session | [startVaultSession / vaultAccess](../../../lib/folder-vault.ts) | [vault tests](../../../tests/folder-vault.test.ts) |
| ENC-04 | Keep AI/search/quote/model-import sources excluded | [document index](../../../lib/document-index.ts), [quote context](../../../lib/quote-context.ts), [model store](../../../lib/house-distribution-store.ts) | [plaintext exclusions](../../../tests/encrypted-document-exclusions.test.ts), [model source denial](../../../tests/house-distribution-store.test.ts) |
| ENC-05 | Guard document writes and cleanup against races | [vault document service](../../../lib/vault-documents.ts) | [route and race tests](../../../tests/vault-documents-route.test.ts) |
| ENC-06 | Reset the password without replacing the content key and invalidate old unlocks | [resetVaultPassword](../../../lib/folder-vault-crypto.ts), [vault route](../../../app/api/folder-vault/route.ts) | [reset integrity tests](../../../tests/folder-vault-crypto.test.ts) |

## Reconstructed decision: envelope encryption and separate unlock authority

**Chosen approach**: AES-256-GCM with contextual authenticated data, an independently generated
folder key wrapped through password-derived material, and temporary user/session-bound unlocks.
Current code also maintains a server recovery wrapper for administrator password reset.

**Alternative**: Treat Documents access as sufficient, or hide files only in the interface.
Either approach would allow an alternate API/indexing path to cross the protected boundary.

**Trade-off**: The server can decrypt authorized content, so this is not E2EE against the server.
Session/recovery key management, permission versions and cleanup races add complexity. Folder names
and operational metadata remain outside content encryption; historic copies are not retroactively sealed.

## Acceptance scenarios and limits

- Ordinary Documents access without an explicit vault grant and active unlock cannot read protected content.
- Approved administrators have implicit grant authority and still require an active password unlock.
- Expired sessions and sessions from an earlier login/permission version fail closed.
- Decryption with the wrong authenticated context fails; ciphertext nonces are distinct.
- AI/search sources remain excluded even for an administrator who has unlocked the folder.
- Password reset preserves the data key but invalidates existing unlock versions.

Crypto tests exercise real Node cryptography. Route/access tests mock storage and identity boundaries.
They are regression evidence, not an independent cryptographic review or production penetration test.

[Security detail](../../architecture/security.md)
