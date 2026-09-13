-- ============================================
-- PER-DOCTOR REPORTING + GENERIC PATIENT DOCUMENTS
-- ============================================

-- ── INVOICE → DOCTOR ATTRIBUTION ──
-- Invoices weren't linked to a doctor before (only optionally to an
-- appointment), so there was no reliable way to report revenue per doctor.
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS doctor_id UUID REFERENCES staff(id);

-- ── PATIENT DOCUMENTS ──
-- Generic uploads (referral letters, prior records, ID proof, lab reports)
-- that aren't X-rays or clinical photos. Reuses the existing xray-images
-- Storage bucket (already has staff access policies set up) under a
-- `<patient_id>/docs/...` path, instead of provisioning a second bucket.
CREATE TABLE IF NOT EXISTS patient_documents (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id UUID REFERENCES patients(id) ON DELETE CASCADE,
  doc_type TEXT CHECK (doc_type IN ('referral_letter', 'prior_records', 'id_proof', 'lab_report', 'other')) DEFAULT 'other',
  file_url TEXT NOT NULL,
  file_name TEXT,
  uploaded_by UUID REFERENCES staff(id),
  uploaded_date DATE DEFAULT CURRENT_DATE,
  notes TEXT,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE patient_documents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "staff_all_patient_documents" ON patient_documents;
CREATE POLICY "staff_all_patient_documents" ON patient_documents FOR ALL TO authenticated USING (true) WITH CHECK (true);
