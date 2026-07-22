-- ============================================
-- PATIENT TAGS, RECURRING APPOINTMENTS, DUPLICATE-PATIENT MERGE
-- ============================================

-- ── PATIENT TAGS/FLAGS ──
-- Quick front-desk awareness (VIP, pediatric, anxious, needs interpreter…)
ALTER TABLE patients ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}';

-- ── RECURRING APPOINTMENTS ──
-- Groups a series so "cancel remaining" can act on all of them together.
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS recurrence_group_id UUID;

-- ── DUPLICATE-PATIENT MERGE ──
-- A merged-away duplicate is marked, not deleted, so old links/references
-- can still resolve to *something* and show where the data went.
ALTER TABLE patients ADD COLUMN IF NOT EXISTS merged_into UUID REFERENCES patients(id);

-- Reassigns every foreign key that points at the duplicate over to the
-- primary, then marks the duplicate as merged. Runs as a single Postgres
-- function so it's one atomic transaction — either everything moves or
-- nothing does, never a half-merged patient.
--
-- Deliberately does NOT touch activity_log: that table has no UPDATE policy
-- by design (an audit trail that can be rewritten isn't an audit trail), so
-- historical entries keep referencing whichever patient id was true when
-- they were written.
--
-- Admin/doctor only — checked here (not just in the UI) since this is a
-- destructive, hard-to-reverse bulk operation.
CREATE OR REPLACE FUNCTION merge_patients(primary_id UUID, duplicate_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF current_staff_role() NOT IN ('admin', 'doctor') THEN
    RAISE EXCEPTION 'Only admins and doctors can merge patients';
  END IF;
  IF primary_id = duplicate_id THEN
    RAISE EXCEPTION 'Cannot merge a patient into itself';
  END IF;

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
  UPDATE patients SET family_head_id = primary_id WHERE family_head_id = duplicate_id;

  UPDATE patients SET merged_into = primary_id WHERE id = duplicate_id;
END;
$$;
