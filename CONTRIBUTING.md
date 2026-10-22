# Contributing and development changes

House Planner is published for portfolio inspection under the [permission-required license](LICENSE).
Obtain prior express written permission before building, running, modifying or reusing the
application. Upstream license rights and GitHub platform functionality remain applicable.
Authorized contributors should start with [setup](DEVELOPMENT.md), [the constitution](.specify/memory/constitution.md),
and [SDD workflow](docs/development/sdd.md).

## A reviewable change

1. Start from a clean branch with the `codex/` prefix and preserve unrelated work.
2. Define a bounded outcome and acceptance criteria with the Spec Kit workflow.
3. Record design decisions and ordered tasks before implementation.
4. Check consistency with the constitution, existing APIs and test conventions.
5. Implement the smallest coherent change; include meaningful permission/conflict tests when applicable.
6. Record actual checks, known limits and a final convergence review.

Documentation-only changes still need accurate links and claims. Existing-feature design cases
must identify retrospective provenance. Use synthetic inputs, including images and model geometry.
Read the installed Next.js guides before framework changes, as required by AGENTS.md.

## Commits and pull requests

Use English Conventional Commits: `feat(scope):`, `fix(scope):`, `test(scope):`, `docs(scope):`,
`refactor(scope):`, `chore(scope):` or `ci(scope):`. Describe the resulting behavior. Keep a commit
focused enough to review or revert; do not manufacture activity, authorship or dates.

PRs connect requirements to implementation, identify changed interfaces, and state validation
and omissions. Refer to [the PR template](.github/pull_request_template.md). Local tests, a merge,
and a production release are separate evidence states. Standard trusted CI is the default release
validation for all ordinary changes, including server, permission and security behavior. Deployment
retains its authorized scope, backup and provenance gates.

Cloud QA is optional for every change. Offer it only at the user's cloud-testing request or for a
specific substantial unresolved question that local testing cannot verify. Before each defined
session, explain its reason, exact source/target, scenarios, time and incremental cost, then obtain
explicit user approval. General merge/deploy/test instructions do not authorize cloud testing;
declining it does not block an otherwise valid CI release. Approval is limited to the session and
its cleanup, with no silent retry or cloud fallback. See [QA policy](docs/qa-workflow.md) and
[005](specs/005-optional-cloud-qa/spec.md).

## Before submitting

```powershell
npm run docs:check
npm run lint
npm test
npm run build -- --webpack
```

Run affected local browser scenarios when relevant. Never include `.env` files, authentication
state, service-account keys, tokens, real documents, client geometry or private backups in a PR.
