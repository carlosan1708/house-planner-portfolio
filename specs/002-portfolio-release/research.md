# Source review

> Historical private-development record. Its commit IDs are metadata only; the original commit objects and review evidence are retained privately and are not part of this public snapshot. See [snapshot provenance](../../docs/portfolio/snapshot.md).

The curated archive changes legacy project/workbook identifiers, browser defaults, billing project
and trusted QA allowlists. It cannot replace operational source safely. The integration whitelist
therefore excludes app/lib runtime, all deployment scripts and the QA regression workflow.
Local demo configuration already uses synthetic loopback defaults on current main. Cloud QA
currently requires one new source build and a full/basic regression within its reservation gate.
