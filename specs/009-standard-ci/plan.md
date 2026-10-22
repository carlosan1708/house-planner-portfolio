# Plan

> Historical private-development record. Its commit IDs are metadata only; the original commit objects and review evidence are retained privately and are not part of this public snapshot. See [snapshot provenance](../../docs/portfolio/snapshot.md).

Keep one standard validate job and the existing mandatory lint/unit/build stages. Add a deterministic browser-scope helper with a bounded smoke fallback and feature-specific selections. Pin its Git blob alongside the reviewed CI workflow in the release verifier, which independently derives applicability from the complete source diff. Separate full browser/emulator regression into workflow_dispatch-only workflow. Preserve cloud QA workflow and budgets. Update verifier boundary tests and active policy, then run mandatory local checks plus selected Playwright; use normal PR/main CI, backup, candidate and exact-source promotion for the pending deploy.

Constitution review: explicit user instruction authorizes this validation-policy amendment and trusted-control update. No full regression or cloud QA is authorized. Preserve historical references and current production ancestry. Main and presentation histories remain separate.
