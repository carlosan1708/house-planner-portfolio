# Plan

> Historical private-development record. Its commit IDs are metadata only; the original commit objects and review evidence are retained privately and are not part of this public snapshot. See [snapshot provenance](../../docs/portfolio/snapshot.md).

Add optional completed/completedAt fields to the client contract and explicit serialized defaults for historical records. Add a complete PATCH action, audit event and atomic cancellation of both notification job stages. Store the completion actor UID in the record and use existing signed activity for attribution. Exclude completed records from in-app alerts and reject them during dispatch. Move countdown card rendering into a focused component with a visible Complete action and native completed-history disclosure; preserve recipient editing.

Constitution: server checks, synthetic tests, no production data writes, no AI/cloud QA. Complete trusted CI remains the release gate. The user authorized only automated verification for this change.
