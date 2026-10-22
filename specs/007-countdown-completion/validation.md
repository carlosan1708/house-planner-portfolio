# Validation

> Historical private-development record. Its commit IDs are metadata only; the original commit objects and review evidence are retained privately and are not part of this public snapshot. See [snapshot provenance](../../docs/portfolio/snapshot.md).

Implementation source: dc5cd47dba81677c6e83b23797da673a67d4362a.

- Full Vitest: 118 files, 1182 tests passed.
- Affected Playwright: 8 scenarios passed with the real CountdownList component and synthetic API/browser persistence fixture. Covers admin/editor completion, before/after due date, history after reload, failure retention, viewer/read-link controls, busy/English labels, 320x700, 390x844 and 844x390 layouts. The first run detected a 36px landscape button; fixed to 44px and all scenarios passed.
- ESLint and TypeScript: passed.
- Production webpack build: passed (62 generated routes).
- Generated 320px screenshot inspected: complete button, preserved title, completion date, original deadline and expanded history fit without overflow. This is inspection of automated evidence, not a manual browser session.

The UI fixture uses sessionStorage persistence to test the component; API persistence/project boundaries and atomic job cancellation are verified in isolated unit tests. It is not authenticated emulator end-to-end evidence. Complete trusted CI, including its existing emulator permission suite, remains required before release. CI outcome is linked from the PR. Manual browser QA was offered and the user selected automated tests only. No cloud QA, live AI calls, production data writes or deployment were performed.
