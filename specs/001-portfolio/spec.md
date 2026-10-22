# Feature Specification: AI Engineer portfolio preparation

> Historical private-development record. Its commit IDs are metadata only; the original commit objects and review evidence are retained privately and are not part of this public snapshot. See [snapshot provenance](../../docs/portfolio/snapshot.md).

**Feature Branch**: `codex/portfolio-sdd`

**Created**: 2026-10-13

**Status**: Ready for planning

**Input**: Prepare House Planner as an English AI Engineer portfolio with clear READMEs,
GitHub Spec Kit adoption, traceable development, coherent commits, and synthetic examples.
Keep the repository private; do not edit the author's profile or deploy the application.

## User Scenarios & Testing

### User Story 1 - Evaluate the product and engineering (Priority: P1)

An engineering reviewer can understand the problem, explore a synthetic demonstration,
and find the AI architecture, safeguards, trade-offs, setup, and validation evidence.

**Why this priority**: The landing README is the project's first technical impression.

**Independent Test**: Follow the README to the demo, engineering docs, and local commands.

**Acceptance Scenarios**:

1. **Given** a fresh reader, **When** they open the README, **Then** they find the problem,
   demo, synthetic visuals, AI behavior, architecture, and documentation entry points.
2. **Given** a local evaluator, **When** they follow development setup, **Then** the demo
   and offline validation do not require credentials for the author's production project.

### User Story 2 - Inspect the development method (Priority: P2)

A reviewer can follow a genuine specification-first change and inspect three reconstructed
design cases without confusing reconstructed evidence with specifications written before code.

**Why this priority**: Method claims need inspectable artifacts, not only badges.

**Independent Test**: Trace a requirement through a plan, task, implementation commit, and check.

**Acceptance Scenarios**:

1. **Given** the portfolio delivery, **When** reviewing its commits, **Then** principles,
   specification, plan, and tasks precede implementation and validation.
2. **Given** an existing-feature case, **When** reading its status, **Then** retrospective
   provenance is explicit and implementation/test references exist.

### User Story 3 - Review a safe publication candidate (Priority: P3)

The author receives a recoverable, sanitized history and a prepared profile card without
changing the live repository's visibility, profile, production state, or current local edits.

**Why this priority**: A portfolio cannot expose client artifacts or invalidate release evidence.

**Independent Test**: Verify backup recovery, history mapping, sanitization, and unchanged remotes.

**Acceptance Scenarios**:

1. **Given** original history and a rewritten clone, **When** comparing commits, **Then**
   authors, timestamps, merge parents, and files are preserved except declared sanitation.
2. **Given** completion, **When** checking GitHub and the original workspace, **Then**
   the repository is private, the profile is unchanged, and local file fingerprints match.

### Edge Cases

- Historic client artifacts can exist in deleted files, branches, tags, and commit messages.
- Real geometry embedded in regression tests must be replaced by meaningful synthetic tests.
- Rewritten commit IDs cannot inherit existing release QA evidence or commit signatures.
- Upstream templates may contain intentional placeholders and external relative links.
- Live model calls and paid QA are outside this delivery; documentation must say so.

## Requirements

### Functional Requirements

- **FR-001**: Provide a concise English README and an indexed documentation hierarchy.
- **FR-002**: Document actual AI context, permission checks, proposal review, and limitations.
- **FR-003**: Adopt a pinned Spec Kit version and preserve existing agent instructions.
- **FR-004**: Record specification, clarification, plan, tasks, analysis, and convergence.
- **FR-005**: Provide three explicitly reconstructed cases with code and test traceability.
- **FR-006**: Prepare a profile card matching the existing Featured Projects format; do not publish it.
- **FR-007**: Preserve recoverable original history and an old/new commit correspondence offline.
- **FR-008**: Normalize historic messages into English Conventional Commits without inventing attribution or dates.
- **FR-009**: Replace real project artifacts and identifiers throughout reachable local history with synthetic examples.
- **FR-010**: Preserve authorization and release gates; document necessary operator configuration after sanitation.
- **FR-011**: Validate documentation, meaningful synthetic regressions, lint, tests, and build.
- **FR-012**: Keep GitHub private, leave the profile untouched, and avoid deployments and paid QA.

### Key Entities

- **Delivery artifact**: requirement, design decision, task, source change, and validation record.
- **Reconstructed case**: current design contract, evidence references, limitations, and retrospective status.
- **History correspondence**: original/new SHA, authorship, timestamps, parent mapping, and allowed file changes.
- **Synthetic example**: fictitious workbook/model/visual that contains no original construction plan.

## Success Criteria

### Measurable Outcomes

- **SC-001**: All local links and image references in authored documentation resolve.
- **SC-002**: All 12 requirements have tasks and recorded acceptance evidence.
- **SC-003**: Exactly three reconstructed cases link to existing implementation and tests.
- **SC-004**: Every rewritten original commit has a verified correspondence and declared differences.
- **SC-005**: Final lint, unit tests, documentation checks, and production build pass locally.
- **SC-006**: GitHub visibility, profile content, production state, and original working files are unchanged.

## Assumptions

- The audience is AI Engineer recruiters and engineering teams; the main language is English.
- Future publication grants no redistribution license; upstream notices remain intact.
- The history rewrite is prepared locally; replacing remote history and publication are separate actions.
- No new product feature or paid model evaluation is needed for this delivery.
- Completed feature artifacts are historical records, with later changes in new feature folders.

## Clarifications

### Session 2026-10-13

- Target: the author's existing profile repository; prepare a card only, without modifying it.
- Visibility: keep House Planner private and do not publish during this task.
- History: improve messages while preserving authors, dates, and merges; sanitation is an explicit exception.
- SDD evidence: portfolio preparation uses the real workflow; earlier designs are reconstructed cases.
- Client material: replace with synthetic examples, not name-only anonymization of actual geometry.
