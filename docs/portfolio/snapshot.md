# Public portfolio snapshot

This repository presents a curated source snapshot of House Planner, a product originally
developed in a private operational repository. The public repository begins with a new initial
commit made at its actual creation time. It does not recreate the original development
chronology or claim that the application was written in one commit.

The source was first published on 2026-10-21. At the author's request, the public initial commit
was replaced on 2026-10-22 before the first GitHub release, with fresh CI required for that
replacement. Earlier public CI records may retain the previous commit reference.

## Source and history boundaries

The original Git history, branches, tags, pull requests, Actions logs, cloud credentials,
production configuration and recovery backups remain private. They are not copied into this
repository. Public workbooks, sample documents, screenshots and model geometry are synthetic.
Installation identifiers are examples and are not instructions to access the author's resources.

The existing `specs/` folders document earlier private development. Their commit identifiers
are historical metadata, explicitly listed in [the reference manifest](private-history-references.json).
Those commit objects are intentionally absent. Documentation checks validate local links,
requirement/task mappings and declared historical references; they do not independently
authenticate the private review history or rerun its recorded acceptance results.

## Production remains separate

The private operational repository continues to own production releases. This public snapshot
does not trigger deployments, replace the production source repository, migrate user data or
change the existing hosted demo. The public README links the author-hosted synthetic demo.

Operational helper scripts are retained as architecture examples with placeholder identities
and fail-closed repository policy. An independently authorized installation requires its own
configuration, trust policy and fresh validation. Public CI uses synthetic configuration and
does not receive production credentials.

## Snapshot-specific safeguards

Email-based invitation and platform-owner decisions require verified email ownership in this
snapshot. Unverified accounts cannot receive a pre-granted invitation membership. Legacy
accounts must refresh their verified sign-in before email-based automatic invitation matching.
These public-copy changes do not establish that a separate running installation has been patched.

Live AI is disabled by default in the public copy. Enabling it is an explicit operator action
and requires independent review of access entitlements, rate limits, quotas and spend controls.
The public synthetic demo makes no live model calls.

## Rights and use

The [Portfolio Inspection License](../../LICENSE) permits source inspection and evaluation of
the author-hosted demo. Building, running, modifying, reusing, redistributing or hosting a
separate application copy requires prior express written permission. GitHub platform rights,
statutory rights and upstream third-party licenses remain applicable.

See the [sanitation scope](sanitation.md), [development guide](../../DEVELOPMENT.md),
[release architecture](../operations/releases.md) and [security policy](../../SECURITY.md).
