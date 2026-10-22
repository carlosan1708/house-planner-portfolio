# Public snapshot and private development history

This repository starts with a new public snapshot. The original operational history remains
private, with its original author and committer dates and release provenance. No original Git
objects, branches, tags, PRs or Actions logs are imported here. This is a source export rather
than a fork or replacement of the production repository.

The initial public commit records the actual time the snapshot is committed. It does not claim
that earlier development happened at that time. Historical specification artifacts are retained
as explicitly labeled records of earlier private work; their commit IDs are metadata only.
See [snapshot provenance](../portfolio/snapshot.md).

## Deployment compatibility

Production continues to deploy from the original private repository. Creating or updating this
public snapshot does not change its service, database, users, authentication or deployment trust.
The public README may point to the same existing synthetic hosted demo.

Operational examples contain placeholder project, workbook, identity and repository settings.
Their fail-closed release gates are not configured for the author's installation. Migrating a
real installation would require deliberate configuration, access review and fresh source-specific
validation; prior private release evidence cannot authorize a new public commit.

## Maintaining this snapshot

Export only reviewed source and synthetic examples. Do not add the private repository as a Git
remote, import its objects, or mirror its branches, tags, PRs or workflow history. Re-audit future
exports before publishing them, and retain real commit timestamps. Keep recovery artifacts
outside the public repository.

The [application license](../../LICENSE) requires prior written permission for uses beyond
portfolio inspection and the author-hosted demonstration. Preserve upstream notices.
