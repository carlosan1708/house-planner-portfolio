# Implementation Plan: AI Engineer portfolio preparation

> Historical private-development record. Its commit IDs are metadata only; the original commit objects and review evidence are retained privately and are not part of this public snapshot. See [snapshot provenance](../../docs/portfolio/snapshot.md).

**Branch**: `codex/portfolio-sdd` | **Date**: 2026-10-13 | **Spec**: [spec.md](spec.md)

## Summary

Prepare an English, reviewable portfolio in an isolated clone. Use pinned Spec Kit artifacts,
document current product behavior, replace client-derived fixtures with synthetic examples,
and produce a locally rewritten history plus an offline recovery and comparison report.

## Technical Context

**Language/Version**: TypeScript, Node.js 22+, Markdown; Python 3.12 for private migration tooling.

**Primary Dependencies**: Existing Next.js 16.3.1 / React 19 stack; Spec Kit 1.2.0, Codex integration.

**Storage**: Repository documentation and synthetic assets; offline Git bundles and JSON reports.

**Testing**: Existing Vitest, Playwright, lint, webpack production build; a dependency-free docs checker.

**Target Platform**: GitHub-rendered Markdown; Windows authoring and Linux CI.

**Project Type**: Existing web application, portfolio documentation and local history migration.

**Performance Goals**: Documentation check completes without network or cloud credentials.

**Constraints**: No remote push, visibility change, profile edit, cloud writes, or paid QA. Preserve local work.

**Scale/Scope**: One main README, documentation index, three reconstructed cases, one real SDD delivery.

## Constitution Check

| Principle | Before design | After design |
|---|---|---|
| Server authorization | Existing checks remain authoritative | No permission weakening planned |
| Isolation and synthetic data | Separate clone and offline backups | Replace client geometry, not just labels |
| Reviewable AI | Describe actual context and proposal workflow | No live model calls or unsupported accuracy claims |
| Quality and provenance | Retain established checks | New SHA values require new release evidence |
| Specifications and evidence | Spec committed before implementation | Cases explicitly retrospective; no fabricated chronology |

No constitution violations. The sanitized clone is a publication candidate, not an approved
replacement production source. Operator configuration must be reconciled before future deployment.

## Project Structure

```text
.specify/                      # pinned shared infrastructure and constitution
.agents/skills/                # bundled Codex integration
specs/001-portfolio/           # spec, research, plan, tasks, analysis, validation
docs/
  README.md                    # navigation by reader intent
  architecture/                # system, AI, workbooks, synthetic distribution
  development/                 # setup, testing, SDD, reconstructed cases
  operations/                  # release, configuration, history migration
  portfolio/                   # profile card and local sanitation report
  images/                      # synthetic demo screenshots
scripts/check-docs.mjs         # offline links, anchors, workflow and evidence checks
scripts/prepare-demo-house.mjs # newly invented model fixture
tests/synthetic-*.test.ts      # behavioral replacements for client-specific regressions
```

**Structure Decision**: Keep the runtime layout intact. Use Markdown for explanatory documents,
Git history for chronological evidence, and local-only reports for original private identifiers.

## Implementation Decisions

1. Adopt Spec Kit in place in the isolated clone; record package version and upstream license.
   Preserve AGENTS.md byte-for-byte. Keep feature selection as local Spec Kit state.
2. Rewrite the README and move operator detail to dedicated guides. The demo has no live assistant;
   explain the private Vertex AI tool flow, lexical document search, and approval boundary accurately.
3. Replace the client-specific house generator and dependent architecture assertions with a newly
   invented compact model and behavior tests. Retain parser, geometry, export, and privacy coverage.
4. Sanitize every reachable historical blob and message with an explicit replacement/removal policy.
   Preserve merge topology using `--prune-empty never --prune-degenerate never`. Retain original authors
   and timestamps. Compare every mapped tree against the declared transformation, not only final HEAD.
5. Normalize messages from actual subjects and changed-file categories. Keep PR numbers and revert
   semantics; translate existing Spanish subjects. Do not alter dates or insert prior SDD claims.
6. Add offline documentation checks to CI and record final local results. Screenshots use only
   anonymous synthetic demo data. Profile output is a draft stored here, not a profile mutation.

## Complexity Tracking

No API, database schema, or dependency architecture changes. Private rewrite tooling lives outside
the repository so original identifiers and recovery artifacts cannot enter a future publication.
