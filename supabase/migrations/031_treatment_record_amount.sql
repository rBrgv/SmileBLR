-- What a procedure cost, kept on the procedure. Treatment records said what was
-- done, to which tooth and by whom, but not for how much, so the only figures
-- in the system were plan estimates and invoice totals — neither of them "the
-- cost of this procedure".
--
-- Records imported from Click4Appointment were linked to the plan line they
-- came from, and that line's amount is already known. Where a line produced
-- exactly one record, that amount is that procedure's cost and is copied over.
-- Where one line covered several teeth, the amount belongs to the line, not to
-- any one tooth; dividing it would be inventing figures the clinic never wrote,
-- so those records are left blank for the clinic to fill in.
--
-- The backfill is not anyone's edit, so it does not write 1,000 rows into the
-- change history under no name; the trigger is paused for it and restored.
BEGIN;

ALTER TABLE treatment_records ADD COLUMN amount NUMERIC(12,2) CHECK (amount IS NULL OR amount >= 0);

ALTER TABLE treatment_records DISABLE TRIGGER log_changes;

UPDATE treatment_records r SET amount = s.estimated_cost
FROM treatment_plan_stages s
WHERE r.stage_id = s.id
  AND r.amount IS NULL
  AND r.deleted_at IS NULL
  AND s.estimated_cost > 0
  AND (SELECT count(*) FROM treatment_records x WHERE x.stage_id = s.id AND x.deleted_at IS NULL) = 1;

ALTER TABLE treatment_records ENABLE TRIGGER log_changes;

COMMIT;
