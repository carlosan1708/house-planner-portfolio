# Local checks

> Historical private-development record. Its commit IDs are metadata only; the original commit objects and review evidence are retained privately and are not part of this public snapshot. See [snapshot provenance](../../docs/portfolio/snapshot.md).

Follow [development](../../DEVELOPMENT.md). Run npm run docs:check, npm run lint, npx tsc --noEmit, npm test, npm run build -- --webpack, and npx playwright test e2e/budget-purchase-links.spec.ts. The focused browser fixture uses actual components with synthetic APIs.

## Payments within Budget

An editor with Expenses access can choose **Registrar abono o pago** beside **Pagado** on a budget card or in the budget editor, including items with no payments. The payment dialog stays in Budget, fixes the selected item, and supports existing or new receipts before saving. New draft items must be saved and applied before recording a payment.

Expand **Ver pagos** under a saved item to see its payment subtable. Selecting a payment opens its amount, date, purchase and associated receipts, with file preview and download. Historical payment detail is already included in the Excel amount and is shown separately from new ledger payments. The collection is loaded once on demand and refreshed after a new payment. Viewers with Expenses access can inspect these details; Budget-only access does not request the payment collection.

After a successful payment, Budget reloads canonical paid totals while keeping the current editor and pending plan changes. If that reload fails, **Actualizar total** retries the read without submitting another payment. Viewer and Budget-only access do not show payment creation controls. Secondary purchase and receipt links retain their existing behavior. **Todas las compras y pagos** opens the existing combined Expenses workspace.

The focused browser fixture covers this interaction, failures, cancel/focus behavior, permissions, unsaved items and narrow layouts. It validates rendered controls against synthetic API contracts; it does not establish authenticated cloud persistence.

When an item has Excel history, the payment form requires an explicit choice: **Pago nuevo: sumar al presupuesto** or **Ya incluido en Excel: no volver a sumar**. It previews the resulting paid total. Historical detail is limited to the original unallocated Excel amount, and reclassifying an existing payment preserves its ID and receipts. Equal amounts alone never trigger reclassification.
