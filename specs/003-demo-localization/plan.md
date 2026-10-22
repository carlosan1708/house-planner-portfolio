# Demo localization plan

> Historical private-development record. Its commit IDs are metadata only; the original commit objects and review evidence are retained privately and are not part of this public snapshot. See [snapshot provenance](../../docs/portfolio/snapshot.md).

## Decisions

Keep sample IDs and canonical values stable. Localize predefined seed fields for display/edit
prefill only when they still match a known seed value and the field has not been edited. Track field
ownership so a deliberate edit equal to the other language's seed stays verbatim. Register bundled
plan-template fields only when applied in demo; keep phase-filter keys stable across localization.
Preserve custom values and real mode verbatim. Do not add language to data-loading effects that reset edited records. Keep permission,
storage, live AI and cloud target configuration unchanged. Read installed Next.js client-component
guides before editing UI code.

Implement bounded localization in the existing demo components, including shared activity
summary/timeline and budget/editor projection. Translate static enum labels as UI, retaining enum
keys. Verify bilingual overview and every public demo section, plus changes across language toggle.
Retain old public download aliases and generate deterministic bilingual workbook aliases from the
synthetic source. Keep technical worksheet identifiers and hidden UUID metadata canonical; translate
visible text and only the localized literals inside status/alert formulas. Verify typed numeric and
formula semantics, styles and parser round trips. Use synthetic local/browser coverage first; release needs fresh source-specific CI evidence. The author-approved presentation mode makes
cloud QA optional for this bounded delivery, without increasing its budget.

## Constitution check

Authorization and project isolation remain unchanged. New sample display uses synthetic data,
no live AI. Honest results and later release evidence remain distinct from archived deliveries.
The author declined a higher QA allowance. Retain USD5.50 / USD5.25 cutoff / 10 builds and every
existing reservation. The operator explicitly selected a CI-based presentation mode; no cloud QA
reservation or model-quality assertion belongs to this release.

## Presentation release validation

Keep the existing cloud QA verifier intact. Add an explicit CI promotion mode that verifies a
successful private-repository push-to-main CI run, the unchanged trusted workflow, all required
steps, a two-parent normal merge whose second parent is the candidate source, and an exact
candidate/run/main tree match. Classify the entire first-parent-to-candidate change: permit only
known client presentation/localization, synthetic assets, documentation and relevant test paths.
Reject server routes, auth/security rules, runtime packages and unreviewed operational changes.
The reviewed CI-helper/deployment integration is a bounded bootstrap, not an arbitrary script
allowlist. Missing, skipped, stale, foreign or mismatched evidence fails before traffic changes.

Verify production backup, build and inspect a zero-traffic candidate, require green PR CI before
normal merge, then green main CI for that exact tree before promotion. Record the selected mode
and the omitted live cloud/model scenarios honestly. Do not edit CI workflow steps or reset QA.

The consistency review clarified constitution 1.0.3: exact-source quality assurance includes
the expressly selected complete CI method for eligible presentation changes. Its authorization,
isolation, backup, cost and provenance requirements remain. The reviewed amendment's exact
blobs are the only governance bootstrap exception, and 001/002 records are untouched.
