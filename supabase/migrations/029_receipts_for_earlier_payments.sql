-- 027 numbers receipts from the payment history, and that history only starts
-- when a payment goes through the payment editor. The invoices already in the
-- system were marked paid on the invoice itself — their payment_version is
-- still 0 — so money the clinic has genuinely received has no receipt behind
-- it, and reception would open a paid bill with nothing to print.
--
-- This raises one receipt per such invoice, for exactly the amount the invoice
-- already records, dated to the invoice. The note says plainly where it came
-- from, so a receipt raised from the record is never mistaken for one written
-- at the counter. Nothing about the invoice itself changes.
--
-- Safe to run twice: an invoice that already has payment history is skipped.
BEGIN;

INSERT INTO invoice_payment_changes(invoice_id, old_amount, new_amount, old_status, new_status, payment_method, note, created_at)
SELECT i.id, 0, i.amount_paid, 'pending', i.payment_status, i.payment_method,
       'Receipt raised from the invoice record when receipt numbering began; the payment was recorded on the invoice, not at the counter.',
       (i.invoice_date + time '12:00') AT TIME ZONE 'Asia/Kolkata'
FROM invoices i
WHERE i.payment_status IN ('paid', 'partial')
  AND coalesce(i.amount_paid, 0) > 0
  AND NOT EXISTS (SELECT 1 FROM invoice_payment_changes c WHERE c.invoice_id = i.id)
ORDER BY i.invoice_date, i.invoice_number;

COMMIT;
