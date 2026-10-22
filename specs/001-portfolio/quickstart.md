# Validate the portfolio delivery

> Historical private-development record. Its commit IDs are metadata only; the original commit objects and review evidence are retained privately and are not part of this public snapshot. See [snapshot provenance](../../docs/portfolio/snapshot.md).

1. Open the root README and follow its demo, architecture, development, and SDD links.
2. Read the constitution, specification, plan, tasks, analysis, and validation in order.
3. Confirm the three design cases say they are reconstructed and link to implementation/tests.
4. Run `npm ci`, `npm run docs:check`, `npm run lint`, and `npm test`.
5. Copy `.env.example` to `.env.local` and run `npm run build -- --webpack` using its isolated
   synthetic emulator settings; build requires no live Firebase connections or cloud credentials.
6. Run `npm run test:e2e` for the local demo and mocked flows; no production QA is implied.
7. Review the sanitation/history summary and the prepared profile card. Neither is publication.

Expected: links resolve, the synthetic model validates, local checks pass, private data is absent
from the rewritten local references, and the original workspace and GitHub state remain unchanged.
