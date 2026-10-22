# Observed causes

> Historical private-development record. Its commit IDs are metadata only; the original commit objects and review evidence are retained privately and are not part of this public snapshot. See [snapshot provenance](../../docs/portfolio/snapshot.md).

Interface translation already exists. Predefined data remains single-language/mixed in
HousePlanner, BudgetWorkspace, ActivityWorkspace, ExpensesWorkspace and AestheticsWorkspace.
AuthGateway's demo branch omits the available initial language. Reloading sample data whenever
language changes would erase edits and countdown dates; use field projection instead. Some
approval group classifications rely on exact canonical strings and must retain those values.

## Release evidence after the author's clarification

Cloud QA reached its approved build allowance. The author declined an increase and explicitly
approved optional cloud QA for presentation changes. The current CI workflow already runs docs,
lint, units, production build, local browser tests, six-user emulator permissions and cleanup.
Use that unchanged trusted workflow on the exact normal-merge tree as the bounded alternative;
retain the existing isolated cloud QA verifier for server and security changes.
