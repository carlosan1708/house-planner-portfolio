# Payments, receipts and Excel

Receipts are reusable evidence. Uploading a photo or PDF does not record money,
require a payment amount, or require a budget item. Unlinked receipts remain in
the receipt library as **Pending link**. Existing invoice files remain available
without copying or migrating them.

## Recording money

In Budget, select **View payments** beside an item's paid amount to open a compact
history of dates, concepts and amounts. Receipt and purchase links open the
selected payment's detail. **Add payment** opens the payment form for that item,
where a new or existing receipt can be attached before saving. On mobile the
history opens as a scrollable bottom sheet. The combined Purchases/Expenses
section remains available for the complete collection.

Use **Record payment** for an amount and date. A payment can have several receipts,
and the same receipt can support several payments. Its budget item is optional;
unassigned payments remain visible in the payment history without changing an
unrelated budget item. A receipt can also be linked to an already saved payment.

A purchase's agreed amount is separate from its payments. Without a linked purchase,
choose **Installment** or **Full payment** and enter the actual amount manually.
Full payment describes the payment; budget quotes and construction progress remain
separate. The same choice is available from an item's payment form in Budget,
and its label is retained in the history, payment detail and Excel export.

For a purchase in the project's currency (USD or CRC),
**Record installment** creates another payment and **Pay balance** proposes the
remaining amount. The server checks the balance again in the same transaction
as the write, including concurrent payments. Payment status does not change
construction progress. Purchases in another currency retain their own amounts but cannot
use these payment actions. The application never converts or combines different currencies.

Select the project currency during creation, or use **Project settings** as its administrator
before or after financial work begins. An untouched starter budget needs no extra confirmation.
An existing budget requires explicit confirmation of a **denomination correction**: every
budget and payment amount stays numerically unchanged, and a new workbook version records
the correction. This is not an exchange-rate conversion. Older drafts and proposals become
stale and must be reopened. Purchases and receipts retain their separately recorded currencies;
balance actions require a purchase in the current project currency. Historical activity remains
unchanged, and corrected payment records retain their original denomination as provenance.
Legacy projects default to CRC.

## Historical amounts and calculated totals

Existing Excel paid amounts are retained as historical balances. Existing payment
detail records describe those balances and do not add money a second time. New
payments are ledger movements. Editing or deleting one movement affects only that
movement; it preserves its receipts and sibling payments.

For each assigned item, the application calculates historical Excel paid plus new
ledger payments. A partial payment cannot replace the full quote in cost/excess
control. Pending amounts based on the quote are explicitly identified as estimates;
the balance of a particular purchase uses its own agreed total and payments.

## Downloading and importing Excel

Supported XLSX downloads include calculated paid totals, a **Resumen de pagos**
sheet and a **Pagos** history with stable payment and receipt identifiers. Those
sheets are for consultation; payment changes belong in the application.

An offline reimport verifies the project, source version, payment snapshot and row
identities. It restores the historical base before storing the workbook, so an
exported cumulative total is never imported as another payment. Changed or stale
payment summaries are rejected before any version is saved. The same protections
apply to draft publication, approval and version restoration. Unsupported XLSX
imports cannot bypass the payment protections.

The connected Google source retains historical paid values. Once an item has new
ledger movements, external edits to its historical paid amount are rejected;
objective and quote edits remain supported. The application and supported XLSX
downloads show the combined paid amount. This does not claim live Google Sheets
end-to-end coverage.

Workbook readers without Expenses permission receive calculated budget totals and
aggregated per-item rows, without private payment IDs, beneficiaries, notes,
receipts or unassigned payment details. Linked receipts cannot be deleted while
an active payment uses them, including legacy invoice files.

## Verification

Unit coverage exercises payment permissions, optional assignment, reusable
receipts, historical accounting, idempotent writes, concurrent balance checks,
receipt retention, workbook round trips and protected write paths. Bounded browser
coverage exercises independent upload, linking, installments and settlement on
desktop, portrait and landscape, including native touch scrolling.

The guarded cloud regression adds authenticated persistence, role and project
isolation, Excel round trips, and cleanup. Its execution remains subject to the
approved session and available [QA budget](qa-workflow.md#cost-target-and-early-cutoff).
