# Implementation plan

> Historical private-development record. Its commit IDs are metadata only; the original commit objects and review evidence are retained privately and are not part of this public snapshot. See [snapshot provenance](../../docs/portfolio/snapshot.md).

## Decisions

1. Use the managed `codex/portfolio-integration` worktree on current operational main. The original user's checkout remains untouched.
2. Import a whitelist of README/docs, Spec Kit assets, completed 001 records, notices, synthetic geometry generator/tests and a lightweight documentation gate. Preserve runtime and cloud targets and the trusted QA regression workflow byte-for-byte.
3. Retain `codex/portfolio-sdd` as a private archive with original preparation commit objects so structured traceability remains verifiable. Preserve release SHA provenance on operational main.
4. Add historical/current scope notices to the README, sanitation and migration documentation. Keep 001 artifacts unchanged; record this integration separately.
5. Run local unit tests/lint/webpack build and CI browser/emulator checks before cloud release. Retain source identity and report omissions.
6. Follow the existing backup, candidate, isolated QA and exact-source promotion scripts. A QA budget increase is a separately reviewed prerequisite; never reset ledger entries or bypass the gate.

## Release order

Specification → plan/tasks → consistency review → implementation → local and CI validation → verified backup → zero-traffic candidate and isolated deployment → full/basic trusted QA + cleanup → exact-tree merge → same-revision promotion → read-only production verification.

## Risks

Sanitized archive defaults are incompatible with existing production data. Copying only the documented whitelist avoids that change. Archived checks apply only to that archive. If main advances or QA fails, reconcile and repeat checks for the final source rather than promoting stale evidence. Budget estimates are safeguards, not measured invoice totals.

## Constitution check

Server authorization, project isolation, grounded reviewable AI, source provenance and honest
specification-first records are preserved. Amendment 1.0.2 separates the completed preparation
from the user-authorized operational release. The only runtime policy change is the explicitly
approved QA budget; it preserves identity, ledger and cutoff enforcement. No unresolved violation.
