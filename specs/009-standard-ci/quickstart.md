# Verification

> Historical private-development record. Its commit IDs are metadata only; the original commit objects and review evidence are retained privately and are not part of this public snapshot. See [snapshot provenance](../../docs/portfolio/snapshot.md).

Run documentation checks, lint, unit tests and webpack build. Inspect the browser scope for the actual base/head and run its selected tests if applicable. Full regression uses a separately authorized workflow_dispatch; cloud QA remains separately approved. Deploy only after successful exact main-push standard CI and a verified backup/candidate.
