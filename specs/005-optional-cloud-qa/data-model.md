# Data Model: Release evidence and cloud approval

> Historical private-development record. Its commit IDs are metadata only; the original commit objects and review evidence are retained privately and are not part of this public snapshot. See [snapshot provenance](../../docs/portfolio/snapshot.md).

No application schema, membership, document metadata or credential storage changes in005.

| Record | Required fields and rules |
| --- | --- |
| CI candidate | Real full commit/tree hashes from clean source; exact normal merge's second parent and tree. |
| Deployed baseline | A ready identifiable revision serving100% traffic; tree equals normal merge's first parent. |
| Trusted CI | Configured private repository; pinned workflow; recent successful main push; all required steps, including real local permissions/cleanup. |
| Source inventory | Complete safe relative paths; unique entries; valid A/M/D transitions; regular modes100644/100755 and correct nonzero/zero blobs. |
| Optional cloud approval | Human instruction for a defined session; reason/scenarios/target/cost known first; no reused approval or implicit generic deployment consent. |
| Release report | Candidate/main hashes, selected mode, CI URL, backup, revision/traffic/contracts, observed results and omitted live checks. |

Cloud approval is a workflow prerequisite, not a trusted flag or an application authorization grant.
All existing cloud leases, reservations, synthetic identities and cleanup records remain unchanged.
