-- Apply before running scripts/import-treatments.mjs.
-- Click4Appointment's treatment history is imported by a script rather than
-- typed in, so every imported row carries the source system's own key and a
-- re-run updates in place instead of duplicating. Partial unique indexes keep
-- the key optional for rows staff create in the app.
BEGIN;

ALTER TABLE treatment_plans ADD COLUMN source_key TEXT;
ALTER TABLE treatment_plan_stages ADD COLUMN source_key TEXT;
ALTER TABLE treatment_records ADD COLUMN source_key TEXT;

-- Plans key on Internal Plan ID; stages add Line No; records add the tooth,
-- because one multi-tooth procedure line becomes one record per tooth.
CREATE UNIQUE INDEX treatment_plans_source_key_unique ON treatment_plans(source_key) WHERE source_key IS NOT NULL;
CREATE UNIQUE INDEX treatment_plan_stages_source_key_unique ON treatment_plan_stages(source_key) WHERE source_key IS NOT NULL;
CREATE UNIQUE INDEX treatment_records_source_key_unique ON treatment_records(source_key) WHERE source_key IS NOT NULL;

-- Click4Appointment tracks a procedure that has been started but not finished.
-- 'scheduled' would misstate those as merely booked, so add the real state.
ALTER TABLE treatment_plan_stages DROP CONSTRAINT IF EXISTS treatment_plan_stages_status_check;
ALTER TABLE treatment_plan_stages ADD CONSTRAINT treatment_plan_stages_status_check
  CHECK (status IN ('pending', 'scheduled', 'in_progress', 'completed'));

COMMIT;
