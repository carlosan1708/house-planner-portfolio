# Data model

> Historical private-development record. Its commit IDs are metadata only; the original commit objects and review evidence are retained privately and are not part of this public snapshot. See [snapshot provenance](../../docs/portfolio/snapshot.md).

Countdown: completed boolean (missing means false), completedAt Timestamp (absent until completed), completedByUid string. Preserve dueAt, startedAt, title, recipients and creator. The API exposes completed and nullable ISO completedAt; actor attribution remains in activity. Both job documents are cancelled in the same transaction. No migration or index required.
