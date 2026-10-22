# House Planner Constitution

## Core Principles

### I. Server-enforced authorization

Every private read and mutation MUST validate identity, active membership, section access,
and applicable folder grants on the server. Project administrator and platform owner are
different authorities. UI visibility MUST NOT substitute for these checks.

### II. Isolation and synthetic demonstrations

Personal workspaces, shared projects, drafts, and offline queues MUST retain their ownership
boundaries. Shared-project notes MUST retain project membership and Notes permission checks;
they are not author-only records. Committed examples, screenshots, and test fixtures MUST use
synthetic data. Real documents, plans, credentials, and historical client artifacts MUST
remain outside a publication-ready repository.

### III. Grounded, reviewable AI

Fresh AI tool retrieval MUST use the caller's permitted sources. Encrypted documents MUST
remain excluded from new plaintext extraction/retrieval. Existing conversation history MUST
be described with its actual permission-revalidation limits; fresh retrieval checks alone
are not evidence that historical answers have been revalidated. Budget proposals MUST pass validation and
the existing draft/approval workflow; model output alone cannot authorize a write.
Documentation MUST distinguish deterministic tests, mocked responses, and live model evidence.

### IV. Reproducible quality and release provenance

Changes MUST pass the applicable lint, test, and build checks. Security and data-flow changes
require meaningful boundary tests. Production promotion MUST retain backup, exact-source
quality assurance, merge, and provenance checks. Standard trusted CI is the default exact-source quality assurance for every change: static/documentation review, unit tests, compilation and bounded applicable Playwright. Full browser and authenticated emulator regression are optional and require an explicit user request/approval; automatic PR/main CI must not trigger them. Preserve meaningful affected-boundary tests and a baseline matching the deployed production tree.
Cloud QA is always optional. Every cloud QA session MUST receive explicit human approval for
its stated scope before setup, provisioning, reservations, builds, regression or live AI. General
instructions to merge, deploy or test do not supply that approval. Offer cloud QA only when the
author requests it or a specific substantial uncertainty warrants cloud validation; explain that
reason, scope and estimated cost first. A refusal or spent allowance MUST NOT force cloud QA or
block the standard-CI lane. Failed CI requires repair, never an automatic cloud fallback.
Rewriting Git history MUST NOT relax those checks or
retrospectively relabel old QA results as evidence for new SHA values.

### V. Specifications and honest evidence

New bounded changes MUST define outcomes and acceptance criteria before implementation,
then produce a technical plan, tasks, consistency analysis, and recorded validation.
Reconstructed designs MUST be labeled retrospective. Commit dates, authorship, performance
claims, and test results MUST NOT be invented. Documentation must match observable code.

## Compatibility and Privacy Constraints

Preserve API authorization and storage semantics. Operator configuration may be externalized,
but a sanitized clone MUST NOT be used to deploy to an existing project without reviewing
its legacy IDs and source provenance. The completed 001 preparation authorized no cloud writes,
paid QA or deployment. The user's subsequent 002 instruction authorizes merge and verified
deployment under existing release/cost gates. Budget increases need explicit approval; visibility
changes and profile edits remain outside scope. The author approved optional cloud QA for bounded
presentation changes in 003, then superseded that restriction with the explicit 005 decision on
2026-10-14: cloud QA is optional for every change and needs approval for each session. That policy
retained then-complete CI, backup and exact-source promotion; the later 009 decision replaces the complete-regression requirement with standard CI; the existing QA budget is unchanged.
Operational main retains private history and
defaults; only the curated archive is covered by its sanitation report.

## Development Workflow and Quality Gates

Use GitHub Spec Kit 1.2.0 with the Codex integration. Run constitution, specify, clarify,
plan, tasks, analyze, implement, and converge as separate steps. Preserve AGENTS.md and
read the installed Next.js guides before touching framework code. Completed feature folders
are historical records; later changes receive a new folder. Keep development setup, product
presentation, and operational instructions separate and linked through the documentation index.

## Governance

This is the first formal constitution, ratified for the portfolio preparation on 2026-10-13.
Its principles derive from existing authorization, QA, deployment code, and the user's scope.
Amendments require an explicit rationale, affected-artifact review, and semantic versioning:
major for incompatible principles, minor for new principles, patch for clarifications.
Each plan records a constitution check; unresolved violations block implementation.

Amendment 1.0.2 clarifies the separately authorized operational delivery and the archive/main
privacy boundary. Completed 001 feature artifacts remain unchanged; the 002 plan records this review.

Amendment 1.0.3 clarifies the method of exact-source quality assurance after the author's explicit
003 decision. It preserves server authorization, isolation, backup and provenance principles.
Affected-artifact review covers the 003 plan/analysis, release verifier tests and operator guides;
001/002 delivery records remain immutable. This is a clarification, not an authorization of live
model claims, higher cost, data migration or unsupported server changes.

Amendment 1.1.0 implements the author's 005 decision: complete CI is the ordinary release lane,
and cloud QA is optional with approval for every stated session. This expands the validation
policy while preserving server authorization, isolation, backup, exact-source provenance, cost
limits and honest omissions. Review covers active operator/agent guides, CI release inventory,
deployment defaults and verifier tests. Completed 001-003 records remain immutable; 004 records
its original policy context and this subsequent decision. No new cloud spending is authorized.

Amendment 1.2.0 implements the author's explicit 009 decision: static review, unit tests and compilation are mandatory, with bounded applicable Playwright. Full browser and authenticated emulator regression become optional/manual on request. Review covers automatic/manual workflows, the independently pinned browser selector, exact-source verifier boundary tests, instructions, skills and operator guides. Backup, normal merge, current production baseline, source/traffic verification and separate cloud-session approval remain intact. Historical acceptance records retain their original scope.

Amendment 1.3.0 records the author's 2026-10-21 authorization for a separate public portfolio
snapshot. It does not authorize changing the original operational repository's visibility,
history, deployment or profile README. This new copy starts with fresh actual-time history,
synthetic installation examples, no production credentials, and the permission-required
application license. Historical specification records are explicitly labeled; their private
commit objects and release evidence are not imported or reused as current validation.
Public CI retains mandatory static/unit/build and bounded browser checks, while full regression
and cloud spending retain their separate approval requirements. Review covers source sanitation,
rights/third-party notices, authentication boundaries, safe AI defaults, CI and snapshot provenance.

**Version**: 1.3.0 | **Ratified**: 2026-10-13 | **Last Amended**: 2026-10-21
