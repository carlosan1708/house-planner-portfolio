# Demo localization validation

> Historical private-development record. Its commit IDs are metadata only; the original commit objects and review evidence are retained privately and are not part of this public snapshot. See [snapshot provenance](../../docs/portfolio/snapshot.md).

**Status**: Local acceptance passed; external CI and release acceptance pending.

Focused unit tests cover bilingual seeds, deliberate edits equal to known translations,
private text, stable numeric/date/ID fields, open editors, filters, notes, and typed synthetic XLSX
round trips. The browser scenarios exercise the actual components with isolated synthetic fixtures;
the entry scenario and manual check use the local Next.js application.

The first full unit run exposed the expected public-assets inventory change. Its explicit whitelist
is updated to include only the new synthetic bilingual aliases; privacy checks remain enabled.
Measured on implementation `4454838878b3835eae5e3e74a8f123d587767614` on 2026-10-13:

| Check | Result |
|---|---|
| Full Vitest suite | 110 files / 1,024 tests passed |
| TypeScript | Passed |
| ESLint | Passed |
| Production build with synthetic local configuration | Passed |
| Focused isolated bilingual browser scenarios | Seven passed, including actual Next.js Spanish entry, within the full suite |
| Full local Playwright suite | 222 tests passed against a fresh compiled local app and isolated synthetic harnesses |
| Documentation | 62 files / 254 local references / zero errors before this evidence update |

The full browser suite passed on `52898092364f9117a242d7d335c0f34345a67f0a`. Fresh GitHub CI is still pending. These counts belong to
the implementation above, not the earlier release. Documentation references are checked again
after final evidence updates. The initial browser run passed 220 cases and failed two stale label
selectors. Three selector fragments were corrected without removing assertions; both focused
cases passed, followed by all 222 cases in the full rerun. Manual Next.js checks confirmed English
and Spanish seed content, stable phase selection and the Spanish footer label.

Cloud evidence from PR #45 belongs to its earlier source, not this change. Production promotion
requires a new clean-source candidate, verified backup, complete trusted CI on the normal main
merge for this author-approved presentation delivery, same-tree/revision promotion and final endpoint
checks. Cloud QA remains required for server, permission/security and unsupported operational changes.

The approved QA ledger currently reserves USD5.20 with 10 builds used under USD5.50 / USD5.25
cutoff / maximum 10 builds. One new build (USD0.35) plus regression (USD0.15) forecasts USD5.70.
The author declined the proposed USD6.00 increase and requested optional cloud QA. The policy
remains USD5.50 / USD5.25 / 10 builds. No new build/regression reservation has been made.
The author explicitly authorized bounded CI-based presentation releases, retaining exact-tree
provenance, complete main CI, verified backup, zero-traffic candidate and final endpoint checks.
The initial automatic review held the persistent control change until that explicit authorization;
it was then approved. No additional QA spending is implied by this choice. Existing reservations,
individual resource controls, leases, authentication and provenance gates are retained.

Limitations: demo content is synthetic and live AI remains disabled. Custom text is intentionally
preserved in the user's chosen language. Real project data is not translated. Canonical technical
worksheet/enum identifiers remain stable, even when their identifier uses Spanish spelling.
Local results establish neither authenticated production behavior nor live model quality.

## Fresh verified backup

On 2026-10-13, the private production backup at
`backups/v0.1.12-20261013-181149` passed source/copy comparison: 1,251 listed storage entries and
103,256,619 bytes. Firestore export completed successfully with 2,488 documents. The originals
were not modified. This is backup evidence, not a production deployment or cloud regression result.

## Final control implementation and source snapshot

On `2eaf380fb328e6e819a3844dee78282e9ff6c3d1`, all 111 unit files / 1,058 tests passed,
including 34 CI-gate rejection/integration cases. ESLint, TypeScript and PowerShell parsing passed.
Application code and assets are unchanged from the compiled UI acceptance source; the new files
implement release verification. The final committed source receives fresh full CI before merge,
then fresh complete main CI for its normal merge before promotion.

The reviewed helper blob is `3f8e73771526f2bf3c1c2d152380cefe2b2a924f`; deployment integration
blob is `5e50b1212b853431a219993462c2b30b318487a1`. Their reviewed copies and hashes are retained
outside the candidate and checked independently before operator execution. CI workflow blob
`9cef14a8fe94baf3d13477cd01c8f785822a71bf` and all QA budget/source tooling remain unchanged.

This immutable feature folder is the pre-release source snapshot. Remaining final CI, candidate,
merge and promotion acceptance is audited in private
PR #46 (private development record) and the external operator report.
Its external results do not require changing the tested source merely to record its own deployment.
No extra isolated cloud regression or live AI/email/Sheets test is claimed.

The final constitution clarification is version 1.0.3, preserving exact-source quality while making
the author-approved presentation method explicit. Its bootstrap classification is pinned to the
reviewed old/new blobs, not a generic governance exemption. On
`f05081a9bcb825bdac276bd10e704f28e437538b`, all 111 files / 1,059 unit tests passed,
including 35 presentation-gate cases. Lint and types also passed; UI acceptance remains 222
browser cases with unchanged application code and assets. Final CI rechecks this complete source.
