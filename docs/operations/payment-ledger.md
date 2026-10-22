# Unified payments and Excel reconciliation

Projects activated with `paymentsModelVersion: 2` calculate budget Paid from active
payment records. Excel no longer contributes a second, hidden balance. Existing
payment IDs, receipt associations and deleted records survive activation.

An unexplained Excel amount becomes a real **Pago de Excel sin detalle** record.
It has no invented date, payee or receipt. Open the payment and choose Edit to
correct its amount or complete its details. Adding another payment always adds
money to the total.

## Synchronization contract

- Repeating an unchanged Excel amount does not create another payment or undo a
  payment edit/deletion in the application.
- A changed external Paid amount above the current payment total creates only
  the difference as an imported payment. For example, recorded payments of 1,200
  and a new external total of 1,300 create one payment of 100.
- A changed external amount below recorded payments produces a conflict. The
  operator must correct the payment records; synchronization never deletes
  identified payments or invents negative adjustments.
- Payment writes and imports share a project ledger revision. A pending workbook
  projection is durable and retried after failure. Concurrent external financial
  edits require reconciliation rather than an inferred overlap.
- Restoring an old budget plan preserves current payments. Stale offline copies
  and old cached payment clients are rejected when they cannot be reconciled.

Generated workbook payment sheets are read-only projections. App downloads
include payment details only with Expenses access. The shared Google workbook
receives summaries; payment descriptions, beneficiaries and receipts retain
their application permissions.

## Reviewed activation

Activation is explicit, per project, and separate from deploying compatible code.
Unmigrated projects retain their previous calculation. New paid amounts are never
imported as a side effect of a GET request.

`lib/payment-migration.ts` creates a pure, deterministic manifest. Its default
preserves the prior total, including legitimate payments added after Excel.
An overlap correction must specify the reviewed line ID, old total, recorded
total, target total and reason. A target below existing payment records is
rejected. The manifest binds the source object, generation, SHA-256, plan version,
all payment fields and receipt IDs. Do not substitute a generic maximum of Excel
and payments: that can discard a legitimate additional payment.

Bundle `scripts/migrate-payments-v2.ts` with the installed esbuild runtime into an
ignored `.qa-tools` output. Its default plan mode reads only a private local
snapshot and workbook, using `--snapshot=<file> --output=<manifest>`.
It does not load credentials or contact services.

After explicit approval of the concrete manifest and a verified backup, apply
mode additionally requires `--apply=<manifestSha256>`, `--backup=<backup-uri>`,
`--release=<compatible-commit>` and `--operator=<identity>`. It rereads the exact
source and all payments, compares the complete manifest, then atomically creates
the imported records, activates v2, advances the financial revision, publishes the
immutable workbook and records an integrity-chained audit event. Any changed
source or payment requires a new reviewed manifest. Failed attempts may leave an
unreferenced immutable recovery candidate; they do not partially activate.

Deploy compatibility before activation. After activation, reverting only to a
legacy application image is unsafe because it would add Excel and ledger again.
Recovery must preserve the v2 ledger or restore the backed-up configuration and
payment state together, with a separately reviewed recovery plan.

Validation uses synthetic unit and bounded browser fixtures. It does not establish
live Google delivery, authenticated production persistence or a cloud QA pass.
