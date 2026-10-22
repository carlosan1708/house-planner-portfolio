# Quickstart: Validate without cloud QA

> Historical private-development record. Its commit IDs are metadata only; the original commit objects and review evidence are retained privately and are not part of this public snapshot. See [snapshot provenance](../../docs/portfolio/snapshot.md).

Use a clean isolated checkout with installed dependencies; keep original local changes intact.

```powershell
npx vitest run tests/release-ci.test.ts
npm run docs:check
npm run lint
npm test
npm run build -- --webpack
```

The pinned CI workflow additionally runs the complete mocked/demo browser suite and guarded
six-user local-emulator permissions/cleanup. Those commands use synthetic data and disabled AI.
See [testing](../../docs/development/testing.md) for exact environment prerequisites.

For the already authorized release: verify backup, inspect the zero-traffic production candidate,
normally merge its exact source, wait for complete main push CI, and promote using that main run ID
with `-ValidationMode ci -CiRunId <run-id>`. See [release instructions](../../docs/operations/releases.md).
PR CI alone cannot authorize promotion. Failed/stale/mismatched checks stop and must be repaired;
they never start cloud QA automatically.

Cloud QA is optional for every change. Only propose it for a substantial unresolved need or a user
request. Explain reason, source/target, scope, cost and duration, then obtain approval for that session
before cloud setup/provisioning/reservation/build/regression/AI. Keep the QA budget and ledger intact.
