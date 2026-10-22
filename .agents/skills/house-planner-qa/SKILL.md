---
name: house-planner-qa
description: "Plan and execute focused House Planner verification with synthetic fixtures, role\
  \ isolation and honest evidence. Use for a requested QA pass or affected-flow validation,\
  \ including choosing between unit, mocked browser and emulator coverage."
---

# House Planner scoped QA

Start with root AGENTS.md, docs/development/testing.md and docs/qa-workflow.md available in this checkout. Standard CI consists of mandatory static review, unit tests and build plus bounded applicable Playwright. Before an optional complete browser/emulator regression or a Git action that triggers it, obtain approval for the specified source, suites, environment, runs and estimated time/cost. Check .github/workflows before any push, PR creation/update or merge. A request for deployment or automated testing alone does not authorize the full regression.

Choose the smallest checks that resolve the affected behavior. A manifest/link edit can use static validation; an API change needs meaningful permission/project boundary tests; browser state or persistence needs the actual affected UI. Do not run the whole application suite merely to validate skill text. Standard release gates still apply when a release is requested and approved.

## Match evidence to its boundary

| Evidence | Establishes | Does not establish |
|---|---|---|
| Focused Vitest | The exercised contract and failure cases | Deployed integration behavior |
| Component/browser fixture | Real rendered controls with the declared mocked contracts | Authenticated API persistence or real service delivery |
| Local Firebase emulators | The exercised auth, project and storage boundaries with synthetic users | Cloud IAM or live AI quality |
| Codex manual browser pass | Actions chosen from inspected rendered state | A full regression or unvisited flows |

Default to isolated local emulators and disabled live AI. Read the existing fixture definitions rather than inventing credentials. Use separate browser contexts for identities; tabs share cookies. Confirm role, project, source commit/tree and target before fixture writes. Shared fixtures require the existing exclusive lease and serialized sessions, even when six identities exist.

For manual inspection, follow docs/manual-browser-qa.md if present. qa:local stops its processes after automated tests; it does not create a keep-open manual session. Establish the documented session guards before manual actions, or report that pass blocked. A screenshot or predetermined Playwright suite is not interactive manual evidence.

Cloud QA needs separately approved session scope and cost before setup/build/reservation or execution. Preserve the private proxy, source guards, ledger, lease and cleanup. Do not use production as writable test data, print credentials, or treat an allowance as authorization.

Keep ordinary outputs in test-results/playwright and playwright-report/local, guarded outputs in test-results/qa and playwright-report/qa, and manual evidence in test-results/manual-qa. Record exact source, commands/scenarios, role coverage, actual results, failures/skips and cleanup; do not overwrite another evidence lane or claim unrun checks passed.

Current CI policy: static review, unit tests and build are mandatory; bounded applicable Playwright is automatic. Full browser/emulator regression is optional and requires a user request/approval. Standard CI is authorized with ordinary work; cloud QA keeps its separate session approval.
