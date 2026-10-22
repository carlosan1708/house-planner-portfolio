# Data model

> Historical private-development record. Its commit IDs are metadata only; the original commit objects and review evidence are retained privately and are not part of this public snapshot. See [snapshot provenance](../../docs/portfolio/snapshot.md).

No application records change. CI evidence adds a deterministic browser selection derived from the source inventory and separately pinned helper blob. Required checks are static review, unit and build; browser install/run may skip only when the independently derived plan is empty. Standard CI does not seed authenticated fixtures, so emulator cleanup is explicitly not required rather than claimed passed.
