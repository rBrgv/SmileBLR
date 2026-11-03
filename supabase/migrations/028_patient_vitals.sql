-- Vitals: the readings taken before a procedure, which the clinic's old system
-- kept on the record screen and this one had nowhere to put. A dental practice
-- checks these because they decide whether to treat today — blood pressure
-- before an extraction, sugar before an implant.
--
-- Recording a reading is a measurement, not a clinical judgement, and in the
-- chair it is usually the assistant holding the cuff. So assistants may record
-- vitals, unlike the other clinical tables; reception may not. Edits are
-- allowed, as everywhere since 026, and keep what they replaced.
BEGIN;

CREATE TABLE patient_vitals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id),
  recorded_on DATE NOT NULL DEFAULT current_date,
  bp_systolic INTEGER CHECK (bp_systolic BETWEEN 50 AND 300),
  bp_diastolic INTEGER CHECK (bp_diastolic BETWEEN 20 AND 200),
  pulse INTEGER CHECK (pulse BETWEEN 20 AND 250),
  -- Fahrenheit and mg/dL, as the clinic's own thermometer and glucometer read.
  temperature_f NUMERIC(4,1) CHECK (temperature_f BETWEEN 90 AND 110),
  spo2 INTEGER CHECK (spo2 BETWEEN 50 AND 100),
  blood_sugar NUMERIC(5,1) CHECK (blood_sugar BETWEEN 20 AND 800),
  sugar_timing TEXT CHECK (sugar_timing IN ('fasting','post_prandial','random')),
  weight_kg NUMERIC(5,1) CHECK (weight_kg BETWEEN 1 AND 400),
  notes TEXT,
  recorded_by UUID REFERENCES staff(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT vitals_bp_pair CHECK ((bp_systolic IS NULL) = (bp_diastolic IS NULL)),
  CONSTRAINT vitals_bp_order CHECK (bp_systolic IS NULL OR bp_systolic > bp_diastolic),
  CONSTRAINT vitals_future CHECK (recorded_on <= current_date + 1),
  -- An empty reading is a mis-click, not a record.
  CONSTRAINT vitals_not_empty CHECK (num_nonnulls(bp_systolic, pulse, temperature_f, spo2, blood_sugar, weight_kg) > 0)
);
CREATE INDEX patient_vitals_patient ON patient_vitals(patient_id, recorded_on DESC, created_at DESC);

CREATE FUNCTION stamp_vitals() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.recorded_by := (SELECT id FROM staff WHERE user_id = auth.uid() AND active);
  RETURN NEW;
END $$;
CREATE TRIGGER stamp_vitals BEFORE INSERT ON patient_vitals FOR EACH ROW EXECUTE FUNCTION stamp_vitals();
CREATE TRIGGER log_changes AFTER UPDATE ON patient_vitals FOR EACH ROW EXECUTE FUNCTION log_record_change();

ALTER TABLE patient_vitals ENABLE ROW LEVEL SECURITY;
CREATE POLICY vitals_read ON patient_vitals FOR SELECT TO authenticated USING (current_staff_role() IS NOT NULL);
CREATE POLICY vitals_insert ON patient_vitals FOR INSERT TO authenticated WITH CHECK (current_staff_role() IN ('admin','doctor','assistant'));
CREATE POLICY vitals_update ON patient_vitals FOR UPDATE TO authenticated
  USING (current_staff_role() IN ('admin','doctor','assistant')) WITH CHECK (current_staff_role() IN ('admin','doctor','assistant'));
CREATE POLICY vitals_delete ON patient_vitals FOR DELETE TO authenticated USING (current_staff_role() IN ('admin','doctor'));

GRANT SELECT, INSERT, UPDATE, DELETE ON patient_vitals TO authenticated;

-- Merging two records for the same person has to carry the readings over,
-- or they vanish with the duplicate.
CREATE OR REPLACE FUNCTION merge_patients(primary_id UUID, duplicate_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF coalesce(current_staff_role(), '') NOT IN ('admin', 'doctor') THEN
    RAISE EXCEPTION 'Only admins and doctors can merge patients';
  END IF;
  IF primary_id = duplicate_id THEN
    RAISE EXCEPTION 'Cannot merge a patient into itself';
  END IF;

  UPDATE consultations SET patient_id = primary_id WHERE patient_id = duplicate_id;
  UPDATE periodontal_exams SET patient_id = primary_id WHERE patient_id = duplicate_id;
  UPDATE medical_history SET patient_id = primary_id WHERE patient_id = duplicate_id;
  UPDATE tooth_chart SET patient_id = primary_id WHERE patient_id = duplicate_id;
  UPDATE appointments SET patient_id = primary_id WHERE patient_id = duplicate_id;
  UPDATE xray_images SET patient_id = primary_id WHERE patient_id = duplicate_id;
  UPDATE treatment_records SET patient_id = primary_id WHERE patient_id = duplicate_id;
  UPDATE prescriptions SET patient_id = primary_id WHERE patient_id = duplicate_id;
  UPDATE treatment_plans SET patient_id = primary_id WHERE patient_id = duplicate_id;
  UPDATE consent_forms SET patient_id = primary_id WHERE patient_id = duplicate_id;
  UPDATE invoices SET patient_id = primary_id WHERE patient_id = duplicate_id;
  UPDATE recall_reminders SET patient_id = primary_id WHERE patient_id = duplicate_id;
  UPDATE lab_orders SET patient_id = primary_id WHERE patient_id = duplicate_id;
  UPDATE referrals SET patient_id = primary_id WHERE patient_id = duplicate_id;
  UPDATE insurance_claims SET patient_id = primary_id WHERE patient_id = duplicate_id;
  UPDATE appointment_waitlist SET patient_id = primary_id WHERE patient_id = duplicate_id;
  UPDATE patient_documents SET patient_id = primary_id WHERE patient_id = duplicate_id;
  UPDATE patient_vitals SET patient_id = primary_id WHERE patient_id = duplicate_id;
  UPDATE patients SET family_head_id = primary_id WHERE family_head_id = duplicate_id;

  UPDATE patients SET merged_into = primary_id WHERE id = duplicate_id;
END;
$$;

COMMIT;
