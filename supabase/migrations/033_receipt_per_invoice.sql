-- The clinic numbers receipts the way Click4Appointment did: RCPT22-1 is the
-- first receipt of invoice 22, RCPT22-2 the second. Patients and insurers have
-- seen that format on every bill, and it says on its face which invoice a
-- receipt belongs to, which 027's single running number did not.
--
-- The running number stays: it is still unique and gapless, and is what the
-- accounts can be reconciled against. This adds the position of a receipt
-- within its invoice, which with the invoice number makes the printed label.
--
-- The position is assigned by the database when a payment is recorded. Payments
-- on one invoice are already serialised (record_invoice_payment locks the
-- invoice row), so two receipts cannot be given the same number.
BEGIN;

ALTER TABLE invoice_payment_changes ADD COLUMN seq INTEGER;

UPDATE invoice_payment_changes c SET seq = o.n
FROM (SELECT id, row_number() OVER (PARTITION BY invoice_id ORDER BY receipt_number) AS n FROM invoice_payment_changes) o
WHERE o.id = c.id;

CREATE FUNCTION set_receipt_seq() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.seq := coalesce((SELECT max(seq) FROM invoice_payment_changes WHERE invoice_id = NEW.invoice_id), 0) + 1;
  RETURN NEW;
END $$;
CREATE TRIGGER set_receipt_seq BEFORE INSERT ON invoice_payment_changes FOR EACH ROW EXECUTE FUNCTION set_receipt_seq();

ALTER TABLE invoice_payment_changes ALTER COLUMN seq SET NOT NULL;
CREATE UNIQUE INDEX invoice_payment_changes_seq ON invoice_payment_changes(invoice_id, seq);

COMMIT;
