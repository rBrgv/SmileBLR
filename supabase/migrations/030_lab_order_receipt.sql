-- A lab order recorded when the work went out and when it was due back, but
-- had nowhere to say when it actually came back, or what was wrong with it
-- ("shade too light", "remake the crown"). Staff were left typing that into
-- the item description. Both get their own column.
--
-- Orders already marked received or delivered keep an empty received date:
-- the system never recorded when, and a date made up now would read as fact.
--
-- Edits to an order keep the previous version, like every other record since
-- 026, so a changed lab name or due date is never lost.
BEGIN;

ALTER TABLE lab_orders
  ADD COLUMN received_date DATE,
  ADD COLUMN notes TEXT;

CREATE TRIGGER log_changes AFTER UPDATE ON lab_orders FOR EACH ROW EXECUTE FUNCTION log_record_change();

COMMIT;
