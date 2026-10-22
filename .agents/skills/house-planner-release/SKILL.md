---
name: house-planner-release
description: "Prepare and publish an explicitly requested House Planner release using the repository's\
  \ backup, exact-source and traffic gates. Use for release preparation or deployment,\
  \ not ordinary feature edits."
---

# House Planner release

Read root AGENTS.md before any validation or GitHub trigger. Read the installed docs/operations/releases.md and scripts/deploy-gcp.ps1 rather than copying old revision IDs or remembered commands. A reconstructed presentation branch is not an operational deployment source.

## Decide before triggering work

Identify the clean checkout, intended diff, current production source and existing validation evidence. Preserve unrelated work in other checkouts. A complete regression requires the user's explicit approval before running it or triggering it through a push, PR update, merge or deployment. Inspect workflow triggers first; a general deployment request or selection of automated tests does not supply that approval. Describe the exact runs (including PR and main separately), source, environment, estimated duration/cost and scope. Continue already approved executions without asking again.

Cloud QA is a separate optional session: offer it only on request or for a substantial unresolved question local evidence cannot answer. Its build, reservation, fixtures, live AI and cleanup scope need their own session approval. A failed CI run never authorizes a cloud fallback. Do not change QA budgets or trusted gates to make a release pass.

## Prepare a verifiable release

- Inspect the installed source and release verifier scripts. Current operational tooling defaults to the CI lane; older archives can have different controls. Missing/incompatible tooling is a reason to prepare a proposal, not to weaken verification.
- For the CI lane, require the immutable reviewed workflow and successful standard main-push CI for the normal two-parent merge of the exact candidate. The candidate and merge trees must agree; the first parent must match the currently deployed tree. If main or production advances, refresh the source and evidence before proceeding.
- Verify a current production backup before the production build. Deploy the clean source with zero traffic using the repository script; record candidate revision, commit, tree, readiness and its basic startup check.
- Promote only the same ready candidate after its required approved validation and normal merge. Use the selected lane's run ID; never relabel old evidence for a new SHA or replace ancestry checks with a tree-only assertion.
- Verify the final single 100-percent traffic target, source commit/tree, Ready condition and public read-only response contracts. A merged PR alone is not a deployment.

Store non-secret release evidence outside tracked source. Distinguish synthetic/local acceptance from actual cloud, AI, Gmail or Sheets evidence; avoid production fixture writes. Report the published URL and observable behavior, with material omissions. For a failure before promotion, leave traffic unchanged and repair only within the approved scope.

Current CI policy: static review, unit tests and build are mandatory; bounded applicable Playwright is automatic. Full browser/emulator regression is optional and requires a user request/approval. Standard CI is authorized with ordinary work; cloud QA keeps its separate session approval.
