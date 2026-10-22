# Testing and evidence levels

Checks answer different questions. A passing local test does not establish production behavior
or live model quality. The [current delivery validation](../../specs/002-portfolio-release/validation.md) records
operational integration checks. [Archived preparation evidence](../../specs/001-portfolio/validation.md)
applies only to the separate curated preparation.

| Level | What it exercises | Limits |
|---|---|---|
| Documentation | Local links/anchors, referenced assets, SDD artifact completeness and traceability | External links and GitHub rendering are reviewed separately |
| Vitest | Domain rules, real crypto, synthetic XLSX/model round trips, mocked route/component behavior | Most cloud/auth/model boundaries are mocked |
| Playwright | Local anonymous demo and mocked workspace interactions | Not an authenticated production session |
| Local emulators | Auth/Firestore/Storage with synthetic users and project isolation | No live email, Sheets, cloud storage or model guarantees |
| Guarded cloud QA | Optional isolated resources, exact source, leases, fixtures, cleanup and budget controls | Every defined session requires prior explicit user approval and available cost allowance |
| Release validation | Backup, static review/units/build and applicable Playwright, exact commit/tree and zero-traffic candidate | Requires authorized operator access and promotion scope; choosing cloud evidence is separate |

## Offline checks

```powershell
npm ci
npm run docs:check
npm run lint
npm test
Copy-Item .env.example .env.local
npm run build -- --webpack
```

The synthetic workbook tests construct their own data in memory. Model regressions use an invented
fixture rather than a client's plan. There is no implicit lookup in the author's Downloads directory.

## Browser and emulator checks

```powershell
# Full browser regression: run only when explicitly requested/approved.
npx playwright install chromium
npm run test:e2e
```

The existing [Playwright configuration](../../playwright.config.ts) starts a local server unless
an explicit test base URL is supplied. Avoid reusing unrelated servers for acceptance evidence.
The focused portfolio screenshots use a fresh anonymous context and only demo data.

For authenticated isolation tests, install Java 21 and the pinned Firebase CLI described in
[the QA workflow](../qa-workflow.md), then use `npm run qa:local -- --suite=permissions`.
Live AI is disabled by default. Do not supply production OAuth tokens to QA.

## Coverage worth reviewing

- [Proposal validation](../../tests/assistant.test.ts) and [public-link API denial](../../tests/public-link-api-guards.test.ts).
- [Draft conflicts](../../tests/permissions-navigation-drafts.test.ts) and [approval diffs](../../tests/approval-diff.test.ts).
- [Vault crypto](../../tests/folder-vault-crypto.test.ts), [document races](../../tests/vault-documents-route.test.ts), and [AI exclusions](../../tests/encrypted-document-exclusions.test.ts).
- [Project isolation](../../tests/project-isolation.test.ts) and [guarded release source](../../tests/release-source.test.ts).

These selected tests make the engineering boundaries visible; they are not a claim of complete
coverage, a penetration test, or a statistical evaluation of model answers.

Standard trusted CI is the default release validation for all ordinary code changes, including
server, permission and security changes, under the [release guide](../operations/releases.md#public-ci).
Affected boundary tests remain required. CI evidence does not turn earlier cloud/model results
into new source acceptance.

Cloud QA is optional for every change. Offer it only for a user request or a specific substantial
unresolved issue that cannot be verified locally. Explain the session's reason, exact source/target,
scope, time and incremental cost, then obtain explicit user approval before cloud work. General
merge/deploy/test instructions do not authorize that session. A refusal does not block an otherwise
valid CI release; failed CI must be repaired rather than triggering cloud automatically. Record
live integrations as untested when omitted. See [005](../../specs/005-optional-cloud-qa/spec.md).

## Current automatic versus requested checks

[009](../../specs/009-standard-ci/spec.md) supersedes the mandatory full-regression part of older evidence: automatic CI always runs static/documentation review, unit tests and build. The pinned source selector runs affected Playwright cases when applicable and explains non-browser skips. `.github/workflows/full-regression.yml` runs all routine browser cases and local authenticated emulator permissions only through an explicitly requested manual dispatch. Standard CI makes no claim that those optional suites ran.
