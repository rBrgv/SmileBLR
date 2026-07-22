-- 005: clinic-scope enhancements — schema only, no policy changes (safe to run
-- any time, unlike 004 which touched RLS). Covers:
--   1. Linking a treatment record to the treatment plan stage it fulfills
--   2. Doctor leave / time-off, so booking can warn about unavailable doctors
--   3. Sequential invoice numbers + an optional tax field
--   4. Periodontal charting (exams + per-tooth readings)
--   5. Digital signature capture for consent forms and treatment plan approval
--   6. Treatment plan templates (reusable stage presets)
--   7. Biomedical waste / equipment maintenance compliance log

-- 1) Treatment record <-> treatment plan stage
ALTER TABLE treatment_records ADD COLUMN IF NOT EXISTS stage_id UUID REFERENCES treatment_plan_stages(id);

-- 2) Doctor leave / time off
CREATE TABLE IF NOT EXISTS staff_leave (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  staff_id UUID REFERENCES staff(id) ON DELETE CASCADE,
  leave_date DATE NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE staff_leave ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "staff_all_staff_leave" ON staff_leave;
CREATE POLICY "staff_all_staff_leave" ON staff_leave FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 3) Sequential invoice numbers + optional tax
-- Healthcare services are commonly GST-exempt in India — confirm with your
-- accountant whether tax_amount even applies before charging it on treatment
-- invoices. The sequential invoice_number is the part that's required
-- regardless (CGST Rule 46 applies to bills of supply too, not just taxed
-- invoices).
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS invoice_number SERIAL;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS tax_amount NUMERIC;

-- 4) Periodontal charting
CREATE TABLE IF NOT EXISTS periodontal_exams (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id UUID REFERENCES patients(id) ON DELETE CASCADE,
  exam_date DATE DEFAULT CURRENT_DATE,
  performed_by UUID REFERENCES staff(id),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS periodontal_readings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  exam_id UUID REFERENCES periodontal_exams(id) ON DELETE CASCADE,
  tooth_number INT CHECK (tooth_number BETWEEN 1 AND 32),
  pocket_depth_buccal NUMERIC,
  pocket_depth_lingual NUMERIC,
  recession NUMERIC,
  bleeding_on_probing BOOLEAN DEFAULT FALSE,
  mobility INT CHECK (mobility BETWEEN 0 AND 3)
);
ALTER TABLE periodontal_exams ENABLE ROW LEVEL SECURITY;
ALTER TABLE periodontal_readings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "staff_all_periodontal_exams" ON periodontal_exams;
CREATE POLICY "staff_all_periodontal_exams" ON periodontal_exams FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "staff_all_periodontal_readings" ON periodontal_readings;
CREATE POLICY "staff_all_periodontal_readings" ON periodontal_readings FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 5) Digital signatures — stored as base64 PNG data URLs directly in the row
-- (small images, avoids needing another Storage bucket + policies)
ALTER TABLE consent_forms ADD COLUMN IF NOT EXISTS signature_data TEXT;
ALTER TABLE treatment_plans ADD COLUMN IF NOT EXISTS patient_approved BOOLEAN DEFAULT FALSE;
ALTER TABLE treatment_plans ADD COLUMN IF NOT EXISTS patient_signature_data TEXT;
ALTER TABLE treatment_plans ADD COLUMN IF NOT EXISTS approved_date TIMESTAMPTZ;

-- 6) Treatment plan templates
CREATE TABLE IF NOT EXISTS plan_templates (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS plan_template_stages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  template_id UUID REFERENCES plan_templates(id) ON DELETE CASCADE,
  stage_number INT,
  description TEXT,
  estimated_cost NUMERIC
);
ALTER TABLE plan_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_template_stages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "staff_all_plan_templates" ON plan_templates;
CREATE POLICY "staff_all_plan_templates" ON plan_templates FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "staff_all_plan_template_stages" ON plan_template_stages;
CREATE POLICY "staff_all_plan_template_stages" ON plan_template_stages FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 7) Compliance log — biomedical waste disposal + equipment maintenance
CREATE TABLE IF NOT EXISTS compliance_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  log_type TEXT CHECK (log_type IN ('biomedical_waste','equipment_maintenance')),
  item_name TEXT NOT NULL,
  log_date DATE DEFAULT CURRENT_DATE,
  next_due_date DATE,
  performed_by UUID REFERENCES staff(id),
  vendor TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE compliance_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "staff_all_compliance_logs" ON compliance_logs;
CREATE POLICY "staff_all_compliance_logs" ON compliance_logs FOR ALL TO authenticated USING (true) WITH CHECK (true);
