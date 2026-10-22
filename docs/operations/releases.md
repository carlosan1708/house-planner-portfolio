# Release architecture and public snapshot boundary

The private House Planner installation uses a guarded release sequence. This public source copy
retains the implementation for engineering inspection, with example configuration and a repository
ID of zero that rejects promotion until an operator deliberately configures an independent setup.
The public repository is not a production deployment source.

## Private product release design

1. Start from clean committed source and verify a recoverable production backup.
2. Run static/documentation checks, unit tests, compilation and affected bounded browser cases.
3. Build a zero-traffic candidate and verify readiness plus its exact source commit and tree.
4. Merge that exact candidate normally and verify trusted main CI against the deployed baseline.
5. Promote the same revision and verify traffic, source provenance and endpoint contracts.

[deploy-gcp.ps1](../../scripts/deploy-gcp.ps1), [release-source.mjs](../../scripts/release-source.mjs),
[release-ci.mjs](../../scripts/release-ci.mjs) and [release-qa.mjs](../../scripts/release-qa.mjs)
illustrate source/evidence checks. They require explicit installation identities, current backups,
reviewed workflows, trusted credentials and fresh source-specific results. Public CI cannot provide
production deployment authorization.

## Public CI

Public CI runs documentation validation, ESLint, unit tests, a webpack production build and bounded
synthetic Playwright coverage. The initial snapshot uses the small CI smoke suite because it has
no previous public commit. Later changes use the affected-flow selector. Full browser and emulator
regression remain manual and require explicit approval; neither publication nor a routine push
runs the full suite. No public workflow holds production credentials or performs a cloud deployment.

The retained manual full-regression workflow is optional. The manual cloud-QA workflow supplies
configuration guidance only; it does not authenticate to cloud resources or launch paid jobs.
An independently configured installation would need its own separately reviewed workflow.

## Production continuity

The original private repository remains responsible for the running product and releases.
Its current release verifier pins its own repository identity, privacy, exact candidate and normal
merge ancestry. Creating this separate public copy leaves those inputs unchanged.

Changing repository identity, visibility or operational history requires a deliberate migration
and fresh validation. An existing running revision does not stop merely because Git history changes,
but old commit-based evidence cannot authorize newly created commits. Preserve those safeguards.

## Independently authorized installations

Obtain written permission under the [LICENSE](../../LICENSE) before building or hosting a separate
copy. Supply your own Firebase/GCP resources, permissions, identity federation, budgets and secrets.
Live AI is disabled by default; an explicit opt-in is not a substitute for access entitlements,
rate limiting and spend controls. See [development](../../DEVELOPMENT.md), [security](../architecture/security.md),
[history boundaries](history-migration.md) and [snapshot provenance](../portfolio/snapshot.md).
