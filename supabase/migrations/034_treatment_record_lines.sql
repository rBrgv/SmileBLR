-- A treatment record becomes a line the way Click4Appointment showed one:
-- how many, at what cost each, less what discount, and whether it is done.
-- Until now a record said what was done and (since 031) what it cost, but a
-- discount had to be worked into the cost, and nothing said whether the work
-- was finished, started or only planned.
--
-- Every existing record is one unit, no discount, completed: that is what
-- they were, so no figure changes and no total moves.
--
-- Status uses the words the plan stages already use (pending is shown as
-- "Planned"), so a procedure reads the same wherever it appears.
BEGIN;

ALTER TABLE treatment_records
  ADD COLUMN units INTEGER NOT NULL DEFAULT 1 CHECK (units >= 1),
  ADD COLUMN discount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (discount >= 0),
  ADD COLUMN status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('pending', 'in_progress', 'completed', 'not_treated')),
  -- A discount cannot be larger than the charge it comes off. Without a cost
  -- there is nothing to compare, so it is not checked.
  ADD CONSTRAINT treatment_record_discount_within_cost CHECK (amount IS NULL OR discount <= units * amount);

COMMIT;
