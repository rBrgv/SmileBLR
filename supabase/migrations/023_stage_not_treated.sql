-- The clinic's own vocabulary for a procedure line is Planned, In Progress,
-- Completed and Not Treated. The first three already exist as pending,
-- in_progress and completed; "not treated" — planned, then decided against —
-- had nowhere to go, so staff had to leave it sitting as Planned forever.
--
-- The stored values stay snake_case and the screens show the clinic's words,
-- so this adds a state rather than renaming 1,544 imported rows.
BEGIN;

ALTER TABLE treatment_plan_stages DROP CONSTRAINT IF EXISTS treatment_plan_stages_status_check;
ALTER TABLE treatment_plan_stages ADD CONSTRAINT treatment_plan_stages_status_check
  CHECK (status IN ('pending', 'scheduled', 'in_progress', 'completed', 'not_treated'));

COMMIT;
