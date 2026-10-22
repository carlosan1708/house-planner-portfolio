# Local validation

> Historical private-development record. Its commit IDs are metadata only; the original commit objects and review evidence are retained privately and are not part of this public snapshot. See [snapshot provenance](../../docs/portfolio/snapshot.md).

Run targeted localization unit/browser checks with synthetic data and live AI disabled, followed
by `npm run docs:check`, `npm run lint`, `npm test`, and `npm run build -- --webpack`.
Cloud release requires separately recorded allowance approval and exact-source trusted evidence.

## Synthetic downloads

Regenerate the additional language aliases with `node scripts/prepare-demo-workbooks.mjs`.
The original `public/demo/House_Planner_Demo.xlsx`, Spanish text files and their URLs are retained.
The generated workbooks keep canonical sheet `Presupuesto` and hidden protocol `_HousePlanner`;
their visible cell content follows the selected language. These identifiers are parser contracts.
