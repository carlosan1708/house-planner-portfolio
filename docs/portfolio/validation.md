# Public snapshot validation

**Status:** first public publication verified; replacement initial commit and first GitHub release
require fresh source-specific CI.
**Updated:** 2026-10-22. The first public snapshot was committed and published on 2026-10-21
after 18:00 America/Costa_Rica. On 2026-10-22, the author requested replacing that public initial
commit before creating the first GitHub release. The replacement uses its actual creation time;
it does not change the recorded time of the earlier publication or its CI evidence.

This record concerns the new public source snapshot only. Historical acceptance results under
`specs/` belong to their original private sources and are not reused as validation of this copy.

## Local results

| Check | Observed result |
|---|---|
| Documentation and local references | Passed; 132 documents and 479 local references before this final record |
| ESLint | Passed |
| Complete Vitest run | 152 files and 1,800 tests passed |
| Final invitation UI follow-up | 34 tests passed, including two additional verified/unverified mailbox cases |
| Production webpack build | Passed compilation, TypeScript and static generation |
| Selected local Chromium | 21 cases passed across CI smoke, bilingual demo and public read links |
| Credential and private-identifier review | No confirmed privileged credential or remaining original client/project identifiers in the reviewed export |
| Synthetic binary assets | Three workbooks, their hidden metadata, image metadata and model asset hashes reviewed |
| Git boundary before publication | Fresh independent repository; no imported commits, original refs or remote |
| License and documentation | Inspection and hosted-demo use permitted; separate execution/reuse requires prior written permission |

The first complete unit run found an SVG newline conversion introduced by export. Restoring its
original LF bytes preserved the existing image/plan integrity manifest; the subsequent complete
run passed. A final UI fixture correction followed the actual invitation login screen and its
34 authentication UI tests passed. These failed intermediate checks are not reported as passes.
The repository includes line-ending attributes to preserve generated asset hashes across systems.

## Execution boundaries

All runtime and browser checks used synthetic local configuration with live AI disabled.
The selected browser tests are bounded coverage, not a full regression. No complete browser or
six-user emulator regression, paid cloud QA, live AI, email or Sheets integration was run.
No production data, cloud permissions, deployed code or private repository visibility changed.

The first public snapshot passed [remote CI](https://github.com/carlosan1708/house-planner-portfolio/actions/runs/39697168272)
before publication. That run checked documentation, lint, all current unit tests, the build and
three bounded CI smoke cases. It validates the original public snapshot only.

The replacement initial commit must pass a new CI run covering the same mandatory checks before
the first GitHub release is published. Its exact commit and successful run will be linked in the
release notes. No new production deployment or live integration validation is part of this release.

## Review scope and limits

The credential-pattern scan is custom and cannot prove the absence of every unknown secret format.
Source review does not verify live production IAM, Firebase rules or independent cloud protections.
The explicit author-hosted demo URL and public author/security contact are intentionally retained.
See [snapshot provenance](snapshot.md), [sanitation scope](sanitation.md) and [LICENSE](../../LICENSE).
