# Research and decisions

> Historical private-development record. Its commit IDs are metadata only; the original commit objects and review evidence are retained privately and are not part of this public snapshot. See [snapshot provenance](../../docs/portfolio/snapshot.md).

**Recorded**: 2026-10-13, before implementation.

| Decision | Evidence and rationale | Alternative considered |
|---|---|---|
| GitHub Spec Kit 1.2.0 | Official existing-project guide; installed bundled Codex skills and templates at pinned tag | OpenSpec; useful for incremental changes, but the requested artifact sequence aligns with Spec Kit |
| Separate clone and offline backup | Original checkout has tracked and untracked work; remote main is newer | Rewriting in a shared worktree could change shared references |
| Honest retrospective cases | Existing implementation and tests exist, but no prior Spec Kit artifacts were found | Backdating specs would invent development evidence |
| No live AI in the demo | HousePlanner renders AssistantPanel only in eligible private workspaces | Previous README table described scripted AI and requires correction |
| Lexical permitted document retrieval | document-index searches authorized extracted PDF/DOCX text; no vector store in this implementation | Do not call the existing retrieval a vector RAG pipeline |
| Genuine synthetic house fixture | Current generator and several regression tests encode one real plan | Merely changing names would retain private geometry |
| Local history preparation | User explicitly keeps repository private and profile untouched | Force-pushing history would alter the operational source before review |

Research inspected current source, test names, CI, release-source guards, and the Spec Kit
existing-project and Codex integration guides. No cloud validation or model calls occurred.

Sources: [existing-project adoption](https://github.github.io/spec-kit/guides/existing-projects.html),
[Codex integration](https://github.github.io/spec-kit/reference/integrations.html),
[pinned upstream source](https://github.com/github/spec-kit/tree/v1.2.0).
