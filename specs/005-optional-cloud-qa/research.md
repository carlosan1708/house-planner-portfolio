# Research: Optional cloud QA

> Historical private-development record. Its commit IDs are metadata only; the original commit objects and review evidence are retained privately and are not part of this public snapshot. See [snapshot provenance](../../docs/portfolio/snapshot.md).

**Reviewed**: 2026-10-14 before implementation; no external service/library selection.

The active CI verifier already verifies complete pinned workflow steps, private repository identity,
recent successful normal-main-merge CI, exact candidate/main tree and currently deployed baseline.
Its presentation allowlist, rather than an authorization or technical limitation, rejected new APIs.
The author's explicit policy decision removes that category restriction while preserving evidence.

| Decision | Reason and alternative |
| --- | --- |
| Complete CI for every regular-file change | Avoid required paid cloud validation; preserving a presentation allowlist conflicts with the author's decision. |
| Strict A/M/D regular-file inventory | Keep complete provenance and reject ambiguous special entries; no arbitrary path whitelist or automatic cloud fallback. |
| Default production validation to CI | Paid QA is separately optional; existing explicitly selected cloud evidence remains supported. |
| Require human approval in agent/operator instructions | A boolean argument cannot prove a conversation happened. Every proposed session needs a reason, scope and estimated cost. |
| Keep cost ledger and cleanup unchanged | Optional QA never implies a new allowance, discarded reservations or unsafe fixtures. |

The current optional QA workflow is manual-dispatch only. Its `basic` AI input default is not approval:
operators must explicitly choose `disabled` unless the approved scope includes basic live AI.
No cloud entrypoint is called by the CI lane. No setup/build/regression/model result is claimed here.
