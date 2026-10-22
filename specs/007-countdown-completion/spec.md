# Countdown completion

> Historical private-development record. Its commit IDs are metadata only; the original commit objects and review evidence are retained privately and are not part of this public snapshot. See [snapshot provenance](../../docs/portfolio/snapshot.md).

Defined before implementation on 2026-10-14. The user cannot finish countdown tasks without deleting them.

- FR-001: Administrators and editors can complete a countdown before or after its deadline without deleting its title, dates or recipients.
- FR-002: Completed countdowns remain readable in a collapsed completed list with completion date; active countdowns retain their existing behavior.
- FR-003: Completion stops in-app alerts and pending reminder jobs. Dispatch rejects completed tasks even if a job survived cancellation.
- FR-004: Server permission and project isolation checks remain enforced; viewers and read links cannot complete tasks. Existing records need no migration.

Acceptance: complete an active and overdue task, reload, find both in completed history, and verify no further alerts or emails. Completion is distinct from per-user acknowledgement. Reopening/rescheduling is outside this bounded change.
