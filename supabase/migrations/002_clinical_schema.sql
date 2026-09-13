-- ============================================
-- SMILE BENGALURU — CONSOLIDATED DATABASE SCHEMA
-- ============================================

-- ── BOOKINGS (already exists) ──
-- Website/WhatsApp enquiries before becoming a patient
-- (no changes needed — already created)

-- ── PATIENTS ──
CREATE TABLE patients (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  full_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  date_of_birth DATE,
  gender TEXT,
  address TEXT,
  emergency_contact_name TEXT,
  emergency_contact_phone TEXT,
  consent_given BOOLEAN DEFAULT FALSE,
  consent_date TIMESTAMPTZ,
  booking_id UUID REFERENCES bookings(id), -- links back to original enquiry
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── MEDICAL HISTORY ──
CREATE TABLE medical_history (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id UUID REFERENCES patients(id) ON DELETE CASCADE,
  condition TEXT,            -- e.g. 'Diabetes', 'Hypertension'
  allergies TEXT,             -- e.g. 'Penicillin'
  current_medications TEXT,
  pregnancy_status BOOLEAN DEFAULT FALSE,
  notes TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── STAFF (doctors, receptionists, assistants) ──
CREATE TABLE staff (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  full_name TEXT NOT NULL,
  role TEXT CHECK (role IN ('doctor', 'receptionist', 'assistant', 'admin')),
  specialization TEXT,        -- e.g. 'Oral & Maxillofacial Surgery'
  qualifications TEXT,
  floor_assigned INT,          -- which floor of the clinic
  phone TEXT,
  email TEXT,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── TREATMENTS (catalogue) ──
CREATE TABLE treatments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,          -- e.g. 'Root Canal', 'Implant', 'Cleaning'
  category TEXT,               -- e.g. 'Surgical', 'Restorative', 'Preventive'
  typical_duration_minutes INT,
  price_min NUMERIC,
  price_max NUMERIC,
  description TEXT
);

-- ── APPOINTMENTS ──
CREATE TABLE appointments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id UUID REFERENCES patients(id) ON DELETE CASCADE,
  doctor_id UUID REFERENCES staff(id),
  treatment_id UUID REFERENCES treatments(id),
  floor_room TEXT,              -- e.g. 'Floor 2, Room 1'
  appointment_time TIMESTAMPTZ NOT NULL,
  duration_minutes INT DEFAULT 30,
  status TEXT DEFAULT 'scheduled' CHECK (status IN ('scheduled','confirmed','in_progress','completed','cancelled','no_show')),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── TOOTH CHART (per-patient dental status) ──
CREATE TABLE tooth_chart (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id UUID REFERENCES patients(id) ON DELETE CASCADE,
  tooth_number INT CHECK (tooth_number BETWEEN 1 AND 32),
  condition TEXT,               -- e.g. 'Decayed', 'Filled', 'Missing', 'Crowned', 'Root Canal', 'Implant'
  treatment_date DATE,
  treating_doctor_id UUID REFERENCES staff(id),
  notes TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── X-RAY IMAGES ──
CREATE TABLE xray_images (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id UUID REFERENCES patients(id) ON DELETE CASCADE,
  tooth_number INT,              -- nullable — panoramic X-rays aren't tooth-specific
  image_type TEXT CHECK (image_type IN ('bitewing','periapical','panoramic','cbct','other')),
  file_url TEXT NOT NULL,         -- Supabase Storage URL
  taken_date DATE DEFAULT CURRENT_DATE,
  uploaded_by UUID REFERENCES staff(id),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── TREATMENT RECORDS (clinical history) ──
CREATE TABLE treatment_records (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id UUID REFERENCES patients(id) ON DELETE CASCADE,
  appointment_id UUID REFERENCES appointments(id),
  treatment_id UUID REFERENCES treatments(id),
  tooth_number INT,
  performed_by UUID REFERENCES staff(id),
  performed_date DATE DEFAULT CURRENT_DATE,
  notes TEXT,
  follow_up_required BOOLEAN DEFAULT FALSE,
  follow_up_date DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── PRESCRIPTIONS ──
CREATE TABLE prescriptions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id UUID REFERENCES patients(id) ON DELETE CASCADE,
  appointment_id UUID REFERENCES appointments(id),
  medicine_name TEXT NOT NULL,
  dosage TEXT,
  duration TEXT,                  -- e.g. '5 days', '2 weeks'
  prescribed_by UUID REFERENCES staff(id),
  prescribed_date DATE DEFAULT CURRENT_DATE,
  notes TEXT
);

-- ── TREATMENT PLANS (multi-stage, e.g. implants) ──
CREATE TABLE treatment_plans (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id UUID REFERENCES patients(id) ON DELETE CASCADE,
  plan_description TEXT,
  total_estimated_cost NUMERIC,
  status TEXT DEFAULT 'proposed' CHECK (status IN ('proposed','accepted','in_progress','completed','cancelled')),
  created_by UUID REFERENCES staff(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE treatment_plan_stages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  plan_id UUID REFERENCES treatment_plans(id) ON DELETE CASCADE,
  stage_number INT,
  description TEXT,
  estimated_cost NUMERIC,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending','scheduled','completed')),
  appointment_id UUID REFERENCES appointments(id)
);

-- ── CONSENT FORMS ──
CREATE TABLE consent_forms (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id UUID REFERENCES patients(id) ON DELETE CASCADE,
  procedure TEXT NOT NULL,
  consent_given BOOLEAN DEFAULT FALSE,
  signed_date TIMESTAMPTZ,
  document_url TEXT,               -- scanned signed form, Supabase Storage
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── INVOICES ──
CREATE TABLE invoices (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id UUID REFERENCES patients(id) ON DELETE CASCADE,
  appointment_id UUID REFERENCES appointments(id),
  amount NUMERIC NOT NULL,
  payment_status TEXT DEFAULT 'pending' CHECK (payment_status IN ('pending','partial','paid','refunded')),
  payment_method TEXT,             -- 'cash', 'card', 'upi', 'insurance'
  invoice_date DATE DEFAULT CURRENT_DATE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── RECALL REMINDERS (6-month checkup automation) ──
CREATE TABLE recall_reminders (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id UUID REFERENCES patients(id) ON DELETE CASCADE,
  last_visit_date DATE,
  recall_due_date DATE,
  reminder_sent BOOLEAN DEFAULT FALSE,
  reminder_sent_date TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── LAB ORDERS (crowns, dentures, aligners sent to external lab) ──
CREATE TABLE lab_orders (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id UUID REFERENCES patients(id) ON DELETE CASCADE,
  lab_name TEXT,
  item_description TEXT,
  sent_date DATE,
  expected_return_date DATE,
  status TEXT DEFAULT 'sent' CHECK (status IN ('sent','in_progress','received','delivered')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── REFERRALS ──
CREATE TABLE referrals (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id UUID REFERENCES patients(id) ON DELETE CASCADE,
  referred_to TEXT,                -- specialist or clinic name
  referred_by UUID REFERENCES staff(id),
  reason TEXT,
  referral_date DATE DEFAULT CURRENT_DATE,
  notes TEXT
);

-- ============================================
-- ENABLE ROW LEVEL SECURITY ON ALL TABLES
-- ============================================
ALTER TABLE patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE medical_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE treatments ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE tooth_chart ENABLE ROW LEVEL SECURITY;
ALTER TABLE xray_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE treatment_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE prescriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE treatment_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE treatment_plan_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE consent_forms ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE recall_reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE lab_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE referrals ENABLE ROW LEVEL SECURITY;

-- ============================================
-- AUTO-UPDATE updated_at TRIGGERS
-- ============================================
CREATE TRIGGER patients_updated_at BEFORE UPDATE ON patients
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER appointments_updated_at BEFORE UPDATE ON appointments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER medical_history_updated_at BEFORE UPDATE ON medical_history
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER tooth_chart_updated_at BEFORE UPDATE ON tooth_chart
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── INVENTORY (supplies & equipment) ──
CREATE TABLE inventory (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  item_name TEXT NOT NULL,
  category TEXT,
  current_stock NUMERIC DEFAULT 0,
  unit TEXT,
  reorder_threshold NUMERIC,
  supplier TEXT,
  last_restocked DATE,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── INSURANCE CLAIMS ──
CREATE TABLE insurance_claims (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id UUID REFERENCES patients(id) ON DELETE CASCADE,
  invoice_id UUID REFERENCES invoices(id),
  insurer_name TEXT,
  policy_number TEXT,
  claim_amount NUMERIC,
  status TEXT DEFAULT 'submitted' CHECK (status IN ('submitted','under_review','approved','rejected','paid')),
  submitted_date DATE,
  resolved_date DATE,
  notes TEXT
);

ALTER TABLE inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE insurance_claims ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER inventory_updated_at BEFORE UPDATE ON inventory
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================
-- STAFF ACCESS POLICIES (authenticated = logged-in staff)
-- ============================================
CREATE POLICY "staff_all_patients" ON patients FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "staff_all_medical_history" ON medical_history FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "staff_all_staff" ON staff FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "staff_all_treatments" ON treatments FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "staff_all_appointments" ON appointments FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "staff_all_tooth_chart" ON tooth_chart FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "staff_all_xray_images" ON xray_images FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "staff_all_treatment_records" ON treatment_records FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "staff_all_prescriptions" ON prescriptions FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "staff_all_treatment_plans" ON treatment_plans FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "staff_all_treatment_plan_stages" ON treatment_plan_stages FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "staff_all_consent_forms" ON consent_forms FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "staff_all_invoices" ON invoices FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "staff_all_recall_reminders" ON recall_reminders FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "staff_all_lab_orders" ON lab_orders FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "staff_all_referrals" ON referrals FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "staff_all_inventory" ON inventory FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "staff_all_insurance_claims" ON insurance_claims FOR ALL TO authenticated USING (true) WITH CHECK (true);
