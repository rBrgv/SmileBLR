-- A receipt is not an invoice. The clinic hands over a numbered receipt each
-- time money changes hands, and Click4Appointment printed one per payment, so
-- the number has to come from the payment event rather than the invoice.
--
-- invoice_payment_changes already records every payment and correction, in
-- order, written only by record_invoice_payment(). Numbering that table gives
-- each receipt a permanent identity and answers the question an edit raises:
-- the invoice keeps its own number for life, while a correction issues a NEW
-- receipt. Nothing is renumbered, so a receipt already given to a patient
-- still refers to what they were handed that day, and the print shows when a
-- later receipt has superseded it.
--
-- Every payment event is numbered, including a refund or a note-only
-- correction, because the sequence has to have no gaps to be worth anything
-- to an accountant. What moved is printed from the amounts, not inferred
-- from whether a number was issued.
BEGIN;

CREATE SEQUENCE receipt_number_seq;
ALTER TABLE invoice_payment_changes ADD COLUMN receipt_number INTEGER;

-- Existing payments are numbered in the order they were taken.
WITH ordered AS (
  SELECT id, row_number() OVER (ORDER BY created_at, id) AS n FROM invoice_payment_changes
)
UPDATE invoice_payment_changes c SET receipt_number = o.n FROM ordered o WHERE o.id = c.id;

SELECT setval('receipt_number_seq', coalesce(max(receipt_number), 0) + 1, false) FROM invoice_payment_changes;

ALTER TABLE invoice_payment_changes
  ALTER COLUMN receipt_number SET DEFAULT nextval('receipt_number_seq'),
  ALTER COLUMN receipt_number SET NOT NULL;
ALTER SEQUENCE receipt_number_seq OWNED BY invoice_payment_changes.receipt_number;
CREATE UNIQUE INDEX invoice_payment_changes_receipt ON invoice_payment_changes(receipt_number);

COMMIT;
