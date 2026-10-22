# Featured Documents Validation

> Historical private-development record. Its commit IDs are metadata only; the original commit objects and review evidence are retained privately and are not part of this public snapshot. See [snapshot provenance](../../docs/portfolio/snapshot.md).

**Status**: Development acceptance complete for the application checkpoint below. Release and the later cloud-QA policy amendment are separate.

**Application source**: `19afb20ea081d28b1ed1e157467fe967aac2b028`.

**Application tree**: `697aee76264c9ac699d8dff63ee4a1643350fd5c`.

**Recorded**: 2026-10-14. Trusted private CI run 38596662823 (private development record) completed successfully against this exact source with execution timestamps retained in private evidence. Its logs and local/manual artifacts were inspected for this record. Later documentation or policy changes require their own source-specific checks; this run is not evidence for an untested later branch head.

## Completed Application Checks

| Check | Measured outcome | Scope/source |
|---|---|---|
| Complete unit suite | PASS: 114 files, 1,149 tests | Local implementation checkpoint and trusted CI at the application source above. |
| Focused pure/backend tests | PASS: 78 tests (20 pure + 58 route) | Parsing/order/cap, authorization/ownership/ancestry, guarded cleanup, atomic rejection and simulated transaction retries. Included in the complete unit count. |
| Picker/component tests | PASS: 12 tests | Search/full paths/checks, cancellation/failure/retry, visible-file baseline, obsolete project responses and bilingual local demo state. Included in the complete unit count. |
| New featured browser suite | PASS: 10 cases locally and within the complete trusted CI run | Actual HousePlanner/picker with synthetic HTTP fixtures; widths 1280/320, locale/role boundaries, preservation, raw Chromium touch scrolling and rotation. These are mocked browser journeys, not live-server authorization. |
| Complete routine browser suite | PASS: 232 cases | Local run at checkpoint `9da82560f157880dcb4cee70bd772d2be1d33941` in 2.0 minutes; trusted CI reran all 232 at `19afb20` in 4.5 minutes. Do not attribute the earlier local run to the later uploader-label fix. |
| Physical local-emulator permissions suite | PASS: 8 cases | Local code checkpoint `34088995f1a151622212be0a0a7047c10bc1a797`; trusted CI reran the suite at `19afb20` in 2.7 minutes. The existing six-identity suite includes a featured-document lifecycle case. |
| Physical local-emulator cleanup | PASS: separate 1 case | Local and trusted CI; CI cleanup took 19.7 seconds. This is not an extra featured UI case. |
| Webpack production build | PASS | Local and trusted CI; compiled the featured route without adding dependencies. |
| Lint | PASS | Complete repository lint locally and in trusted CI. |
| Documentation checker | PASS: 74 files, 303 local references, 0 errors | Trusted CI at `19afb20`; the evidence/policy closeout must recheck its updated documentation separately. |

## Permission and Preservation Evidence

The physical runs used fixed synthetic project `demo-house-planner-qa`, loopback Auth 9099, Firestore 8088 and Storage 9199, with AI disabled. The new lifecycle case verifies ordered administrator/editor selection, reload persistence, viewer write denial, restricted-folder projection, no Overview dependency, atomic foreign/missing target rejection, preservation of a valid hidden selection, unchanged file locations/content, and revoked-access denial. It restores changed grants/selections and has a separate cleanup run.

Unit tests cover malformed IDs, deleted/missing/foreign references, unlocked encrypted ancestry, reserved expense folders, structural cleanup only after valid submitted intent, hidden-selection capacity, config preservation and simulated retries/concurrent races. The physical suite does **not** claim newly created vault/deletion cases or real transaction-conflict emulation. Live models, Google integrations, outbound email and cloud QA were not exercised.

Independent review found native anchor/image dragging could bubble into a Featured row despite `draggable=false`. The UI commit added an early drag guard; the browser regression verifies no file move. Explicit Unfiled/folder operations remain separately exercised. The touch case uses raw Chromium input events with `hasTouch`/mobile context: the candidate list scrolls, the final candidate can be selected, the locked page stays still, rotation from 320 portrait to 844 by 390 landscape preserves the draft and usable controls, and Cancel restores page scrolling. This is browser touch emulation, not a physical-device test.

## Manual Synthetic Review

Manual review used normal browser sign-in, synthetic identities and local-only Auth/Firestore/Storage, with source guards, an exclusive fixture lease and cleanup. It is scoped acceptance evidence, not the complete regression or release gate. Private details are retained under ignored `test-results/manual-qa/featured004/report.md` and `.qa-tools/logs/` without credentials in tracked documents.

| Session/scenario | Observed result |
|---|---|
| Supplemental demo, desktop and 390 mobile | PASS for choosing documents from different folders, Save/Cancel, default root, folder navigation, locale/navigation preservation and bounded picker layout. A 755-byte synthetic PDF uploaded into an ordinary folder, stayed absent from Featured until selected, and could be featured alongside the seed quote. |
| Guarded run `manual004-1791994741964-2b7cb241` | PASS for administrator sign-in, empty Featured default, Cancel plus reload, filtered draft preservation, ordered save/reload and original-folder navigation. An ordinary PDF file-chooser operation stalled; the 45-minute session limit stopped services. Real upload completion is unproved. |
| Guarded run `manual004-1792005256639-c2dc875d` | PASS for administrator saving two documents, viewer reading both without a chooser, restricted viewer seeing only its one permitted document before/after reload, and an outsider being denied the primary project without private filenames. Sign-out plus reload removed private rows. Viewer 390 viewport had scroll width 375, with no horizontal overflow. |
| Fixture cleanup | PASS for both guarded runs: own lease released, synthetic baseline restored, credentials removed, services stopped. Stop times were [execution timestamp retained privately] and [execution timestamp retained privately]. Both runs used `19afb20` / tree `697aee7`. |

The supplemental demo review identified an English generated uploader label in a Spanish row. Commit `19afb20` translates only the generated demo label; its expanded browser cases and complete CI verify the fix and retain real author/custom filename text verbatim. That Spanish upload/author sequence was **not manually repeated after the fix**.

Ancillary manual limits: the PDF preview controls opened, but its pixels were gray in the in-app browser, so native PDF rendering is **BLOCKED/unverified**. The stalled real-emulator file chooser is **BLOCKED**, and no completed manual real upload/download is claimed. The long interrupted session is not described as a continuous 15-minute pass. Editor/companion roles are covered by physical automation, not manual sign-in. No actual-device touch, live AI, cloud QA or production-data mutation occurred.

## Earlier Failures and Corrections

- The initial affected browser run returned 86 PASS and 4 FAIL out of 90 because legacy assertions expected Unfiled at the root. Those assertions now explicitly select Unfiled.
- The first complete routine run returned 229 PASS and 2 FAIL out of 231. Initial CI run 38593344509 (private development record) at `3408899` failed the same inactive-authorship expectations. Neither run is reported as a pass.
- Test amendment `f92e71af2fd58f1fe3f2a9ba92df35c08c78fdd0` keeps the inactive-author assertions and selects Unfiled; the targeted two-case rerun passed in 8.8 seconds.
- Commit `073575857cba2cf8aa612e7faff8213a8efdd16b` added the measured touch/rotation case, raising the focused total from 9 to 10. The subsequent local 232-case pass and exact-`19afb20` trusted CI pass supersede those failed checkpoints.

## Release and Policy Boundary

This feature's application development is accepted; private PR 47 (private development record) is the review artifact. No feature004 cloud QA or production deployment is claimed in this record. Deployment status must come from exact-source release evidence.

On 2026-10-14 the author changed the policy: cloud QA is optional for every change, requires an explicit approval for each run, and is offered only for a substantial validation need or the author's request. [005](../005-optional-cloud-qa/spec.md) records that amendment separately. It supersedes the earlier presentation/server classification, while backup, trusted source-specific CI, candidate/provenance checks and existing cost controls remain applicable. No extra QA spend is approved. Final integrated policy-source validation and release remain separate from the application checkpoint above.

## Reproduction and Private Reports

Tracked checks: [pure tests](../../tests/featured-documents.test.ts), [route tests](../../tests/featured-documents-route.test.ts), [component tests](../../tests/featured-documents-selection.test.tsx), [new browser suite](../../e2e/featured-documents.spec.ts), [physical permission lifecycle](../../e2e/qa-permissions.spec.ts). Commands/setup are in [quickstart](quickstart.md).

Ignored `test-results/qa/`, routine Playwright output, manual reports and `.qa-tools/logs/` remain private artifacts, not Markdown targets required by CI. This tracked record contains measured scope/status, no generated credentials or real project content. Complete CI for later documentation/policy revisions must identify its actual commit/tree rather than reuse the application-source result.
