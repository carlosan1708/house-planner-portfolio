# Codex manual browser QA

Codex acts as the manual tester: inspect the rendered application, choose the next action from what is visible, use the normal controls, and compare the observed result with the requested behavior. This adds exploratory and visual checks to Vitest and Playwright. Running a Playwright suite alone does not count as this manual pass.

## When to offer a run

Offer a focused browser pass when completing a requested feature, a reported bug fix, or an important change to permissions, persistence, navigation, uploads, spreadsheet editing, or deployment behavior. Explain the affected flow, relevant identities, environment, and approximate duration. If the user already requested this testing, continue within that scope without requesting the same authorization again.

| Scope | Target time after the session is ready | Selection |
|---|---|---|
| Browser smoke | 5–10 minutes | Core checklist and one representative feature action |
| Feature or bug check | Smoke plus 3–5 minutes | Requested acceptance criteria, original bug trigger, and a nearby edge case |
| Important change | 15–25 minutes | Relevant roles, adjacent flows, persistence, and responsive/error behavior |
| Small wording/style change | 2–5 minutes | Affected screen and relevant narrow layout |

These are planning estimates. Setup and troubleshooting are reported separately. A blocked browser, failed scenario, or exhausted allowance is recorded explicitly; it is not a pass. At the time budget, report what was actually checked and propose any necessary extension.

An optional offer does not create a new release approval gate. Continue already authorized implementation and automated validation while awaiting an optional manual-test decision. Standard trusted CI and exact-source release gates remain required. Cloud QA is optional for every change, and declining it does not block an otherwise valid CI release.

## Environment and session setup

Default to a clean committed candidate in a managed worktree, the `demo-house-planner-qa` Auth/Firestore/Storage emulators, synthetic `qa-primary` and `qa-isolation` data, and disabled live AI. This avoids additional Google Cloud usage; Codex/account usage is separate. Record the exact commit and tree and verify the app reports the intended source and isolated environment before any fixture writes.

Offer deployed `house-planner-qa` only at the user's cloud-testing request or for a specific substantial unresolved question that local testing cannot verify. Explain the expected additional evidence; a runtime, IAM, storage, server or security change alone does not require a cloud offer.

Before every defined cloud session, record its reason, exact source/target, selected scenarios and identities, required setup/build/regression/AI operations, estimated duration and incremental cost, then ask for and obtain explicit user approval. General merge/deploy/test instructions, a workflow dispatch and available allowance do not authorize cloud QA. Approval covers that session and necessary cleanup; do not reuse it for a new session, silently retry or fall back to cloud. Continue locally and retain the CI release option if the offer is declined.

After approval, reuse an already deployed matching candidate where possible. A new source deployment still needs its build reservation. Reserve the manual cloud session as one uniquely identified regression operation through the existing durable budget ledger before cloud work; manual browsing must not bypass monthly operation limits or the $5.75 early cutoff/$6.00 target. Live AI remains separate explicitly approved scope. See [005](../specs/005-optional-cloud-qa/spec.md).

Cloud QA is IAM private. Use the validated authenticated localhost proxy; preserve private service access. Production data is never a writable fixture. A production data repair requires the user's approval, independently of any code fix or test result.

Before starting:

1. Verify available browser-control tools and the target URL. Inspect the actual page before choosing each UI action. If the integrated runtime cannot initialize, use the supported-library fallback below when available. If neither option works, report `BLOCKED` and finish other authorized checks; do not label automated tests as manual results.
2. Establish a guarded session with synthetic fixtures, secure QA-only credentials, an exclusive expiring QA lease, and a cleanup/shutdown path. Acquire the lease through the QA API after ordinary UI sign-in and before fixture writes. Coordinate with Playwright runs so their resets cannot interfere with the manual session.
3. Confirm the signed-in identity, role, and project before writes. Start with the owner, viewer, and outsider; add editor, restricted viewer, or companion when the affected behavior needs them. Use the six fixed identities described in [QA workflow](qa-workflow.md#synthetic-identities).
4. Use separate isolated browser sessions where supported, or sign out completely and verify the next identity before testing sequentially. Different tabs alone do not isolate cookies. Keep credentials and session tokens out of reports and screenshots.

**Current prerequisite:** `npm run qa:local` launches Playwright and automatically stops the app/emulators when the suite ends. It has no manual/keep-open mode. Before the first local manual run, provide a guarded keep-open mode or a separately managed emulator session that reuses credential isolation, fixture seeding, source verification, lease coordination, cleanup, and process shutdown. This document does not implement that mode or introduce a runnable manual command.

### Browser-control fallback

When the integrated browser-control or bundled Node runtime is unavailable, Codex may use an ordinary Node.js REPL (`node --experimental-repl-await`) with the installed Playwright library to launch a fresh headless Chromium browser. Codex must inspect the rendered page text and screenshots, choose the next action from that observed state, and exercise normal UI controls. This is an interactive manual pass using a supported browser library; executing a Playwright test suite or a predetermined scenario script does not supply manual evidence. Record the actual runtime, viewport, and observed setup failure. Using the fallback does not establish that the integrated runtime was repaired.

The fallback changes only browser control. Prepare it from a clean managed candidate checkout and retain the existing target/source validators, authenticated loopback proxy, and QA-only identity checks. For an approved cloud session, verify that the candidate commit/tree exactly matches the deployed revision and reuse the exports in [the QA proxy](../scripts/qa-cloud-proxy.mjs), including its renewing ID-token provider, with short-lived approved operator or WIF credentials held in process memory. Keep synthetic passwords from QA Secret Manager in process memory as well; never print credentials or tokens or include them in commands, reports, or screenshots. Preserve IAM-private access and the durable regression reservation; do not bypass guards, substitute native or undocumented browser APIs, or introduce a separate proxy implementation.

Accessibility snapshots can include password-input values even when the rendered control masks them. Before emitting any text or snapshot, redact every credential value in memory, including passwords and tokens, from the captured output. Do not rely on masking or truncation. Prefer screenshots taken after sign-in, when credential fields are no longer present.

If a native PDF preview is blank in Chromium's headless shell, repeat that observation with the installed full Chromium channel and its native PDF viewer, retaining the same isolation and QA guards. Record the browser/channel and rendered result. A headless-shell rendering limitation alone is not an application defect; if the full browser still fails, preserve the observation and investigate the application flow. Report PDF rendering as blocked or untested if the appropriate browser is unavailable.

Use fresh isolated browser contexts for the selected identities, perform ordinary UI sign-in, and acquire the guarded lease before writes. Track every disposable record or baseline edit, complete cleanup, release the lease, close the browser and proxy, and stop the REPL and any managed local processes. Any temporary QA-only IAM permission explicitly authorized for setup must also be removed and its cleanup recorded.

There is no dedicated manual-session launcher at present. Codex can prepare this ordinary REPL fallback using the installed library and existing QA exports; it does not add a new repository command or remove the local keep-open prerequisite above. Runtime availability and a completed manual pass are separate results.

## Core browser checklist

Use tiny disposable records, prefix them with the manual run ID, and track the IDs/links created or modified by the run. For edits to existing synthetic fixtures, retain their original values and restore the baseline during cleanup. Select a representative record rather than repeating every product scenario. For access-control changes, run viewer/outsider denial checks before longer feature exploration.

| Check | Manual action and expected result |
|---|---|
| Sign-in and workspace | Owner signs in to the intended synthetic project. Project/identity are correct; private navigation and dashboard load without a visible error. |
| Navigation and main data | Open Budget and Expenses; totals agree with the known fixture. Open one document/image preview. Navigate to the affected feature through normal controls. |
| Changed feature | Perform its main acceptance scenario through the UI. Verify exact values and linked records, not just a success toast. Create/edit a disposable record when the feature writes data. |
| Persistence | Reload, navigate away/back, and reopen its direct link. The saved result and intended selection remain correct. |
| Viewer access | Viewer reads the permitted changed record. Editing is unavailable. A protected page/file link requiring additional rights remains denied. Existing API tests provide the complementary server write-denial checks. |
| Project isolation | Outsider signs in to `qa-isolation`; the `qa-primary` record/file link is denied and owner data does not appear through navigation or cached views. Use ordinary direct-link navigation, not privileged state injection. |
| Layout and interaction | Inspect desktop layout. For UI changes, inspect a narrow/mobile layout with supported viewport tools. Check scrolling, clipped controls, dialogs, loading/error feedback, and keyboard focus where affected. A narrow viewport does not establish real-device/camera compatibility. |
| Cleanup and sign-out | Remove/restore the tracked fixtures with their owning QA identity or guarded cleanup and release the lease. Sign out, refresh/back-navigate, and verify private content is no longer accessible. Stop the test processes and record cleanup outcome. Budget reservations and monthly AI attempts remain counted. |

## Checks selected by change

| Change | Add these scenarios to the core pass |
|---|---|
| Sign-in, roles, sharing, or project switching | Relevant editor/restricted/companion sessions; direct-link denial, invitation/read-link acceptance or revocation, and sign-out/project-switch cache behavior. |
| Workbook, expenses, or approvals | Exact amount/formula, save/reload, affected download/reupload, stable copied-row identity, receipt ownership, editor submission, and owner approval as relevant. |
| Documents, vaults, or Aesthetics | Tiny upload, preview/download, folder link and rename/move, curated order after reload, denied file access; lock/unlock and encrypted descendants when affected. |
| Distribution/3D | Rendering and camera/view controls, changed dimensions/corrections, save/reload, affected export, and narrow layout. |
| Notes, activity, or mobile capture | Author/project privacy, correct linked record, reload; failed-save or offline retry when changed. Actual microphone/camera/device checks are explicit additional scope. |
| Quotes or assistant | Default to local synthetic behavior. For an explicitly approved basic cloud probe, use tiny readable offers and verify each supplier's actual amount and one concise follow-up. Preserve server-enforced AI limits and no automatic retries; report extended grounding/search/OAuth/email as untested. |
| Reported bug | Reproduce the original trigger against a safe pre-fix candidate when available; otherwise record that baseline as untested. Verify the corrected behavior, one nearby edge case, reload persistence, and affected permissions. |
| Runtime/IAM/storage/deployment | Test locally first. If a specific substantial unresolved integration question cannot be verified locally, explain it and offer an optional bounded matching-source cloud session requiring explicit approval. |

For a UI bug, capture its visible symptom and the corrected result. For a data bug, verify exact synthetic values and relationships. After a failure, preserve concise reproduction evidence, fix code and repeat the failed/adjacent checks on the new candidate. Do not silently retry until green or convert an intermittent failure into an uninterrupted pass.

## Report and acceptance

Report in the current chat and save a small report under ignored `test-results/manual-qa/<run-id>/`. Keep selected credential-free screenshots when useful; avoid continuous video/large traces for a successful lightweight pass. Include a short validation summary in the PR description when updating that PR is part of the task.

Routine Playwright artifacts use `test-results/playwright/` and `playwright-report/local/`; guarded regression artifacts use `test-results/qa/` and `playwright-report/qa/`. Keep those output directories separate from `test-results/manual-qa/` so automatic cleanup preserves manual and guarded QA evidence.

Use this report structure:

```markdown
# Codex manual browser QA
Run ID / date:
Commit / tree:
Environment / URL / QA revision:
Browser / viewport:
Browser-control runtime / setup limitations:
Identities and projects:
Scope and requested acceptance criteria:
Setup time / test time:

| Scenario | Expected | Observed | PASS / FAIL / BLOCKED / NOT TESTED | Evidence |
|---|---|---|---|---|

Bugs: reproduction, impact, fix/retest status.
Cleanup: removed fixtures, released lease, stopped processes, any remaining items.
Omissions: live integrations, roles, devices, or scenarios not exercised.
Cloud session approval, reason, scope, time/cost estimate and reservation / AI attempts, if applicable:
Overall result for the declared scope:
```

Declare the pass successful only when every selected required scenario and cleanup pass. State any failed, blocked, or untested acceptance criterion clearly. This is scoped evidence, not a guarantee of zero bugs or complete authorization coverage. It does not replace standard trusted CI or exact-revision production promotion. If the optional cloud evidence lane is selected, its eight-suite regression, basic live AI evidence and cleanup requirements also remain in force; that lane never makes cloud testing mandatory.

Example future local offers: “Run a 5–10 minute local Codex browser smoke plus the new carousel flow?” or “Run a 15–25 minute local browser pass for this access-control change, including viewer/restricted/outsider cases?” A cloud offer first identifies the specific substantial question or user request, exact source/target, proposed operations, estimated time and incremental cost within the existing allowance, then asks for explicit approval of that session.
