-- ============================================
-- ROUND 2 GAPS — waitlist, referral source, clinical photos
-- ============================================

-- ── APPOINTMENT WAITLIST ──
-- Patients who want an earlier slot than what's currently open; lets front
-- desk fill a last-minute cancellation instead of leaving the chair empty.
CREATE TABLE IF NOT EXISTS appointment_waitlist (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id UUID REFERENCES patients(id) ON DELETE CASCADE,
  doctor_id UUID REFERENCES staff(id),
  treatment_id UUID REFERENCES treatments(id),
  notes TEXT,
  status TEXT DEFAULT 'waiting' CHECK (status IN ('waiting', 'notified', 'booked', 'cancelled')),
  added_date DATE DEFAULT CURRENT_DATE,
  notified_date TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE appointment_waitlist ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "staff_all_appointment_waitlist" ON appointment_waitlist;
CREATE POLICY "staff_all_appointment_waitlist" ON appointment_waitlist FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ── PATIENT REFERRAL / MARKETING SOURCE ──
ALTER TABLE patients ADD COLUMN IF NOT EXISTS referral_source TEXT;

-- ── CLINICAL / INTRAORAL PHOTOS ──
-- Reuses the xray_images table + storage bucket instead of a parallel one —
-- same signed-URL viewer, same delete/restore flow, just a new image_type.
ALTER TABLE xray_images DROP CONSTRAINT IF EXISTS xray_images_image_type_check;
ALTER TABLE xray_images ADD CONSTRAINT xray_images_image_type_check
  CHECK (image_type IN ('bitewing', 'periapical', 'panoramic', 'cbct', 'clinical_photo', 'other'));
