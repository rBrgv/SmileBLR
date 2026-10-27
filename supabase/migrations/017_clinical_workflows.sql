BEGIN;
-- Preserve existing numbering: do not guess whether old 1–32 values were Universal or FDI.
-- NOT VALID retains legacy rows while checking all new/updated values.
CREATE FUNCTION valid_fdi_tooth(n INTEGER) RETURNS BOOLEAN LANGUAGE sql IMMUTABLE AS $$
 SELECT n IS NULL OR (n / 10 BETWEEN 1 AND 4 AND n % 10 BETWEEN 1 AND 8) OR (n / 10 BETWEEN 5 AND 8 AND n % 10 BETWEEN 1 AND 5)
$$;
ALTER TABLE tooth_chart DROP CONSTRAINT IF EXISTS tooth_chart_tooth_number_check;
ALTER TABLE tooth_chart ADD CONSTRAINT tooth_chart_fdi CHECK(valid_fdi_tooth(tooth_number)) NOT VALID;
ALTER TABLE periodontal_readings DROP CONSTRAINT IF EXISTS periodontal_readings_tooth_number_check;
ALTER TABLE periodontal_readings ADD CONSTRAINT periodontal_readings_fdi CHECK(valid_fdi_tooth(tooth_number)) NOT VALID;
ALTER TABLE treatment_records ADD CONSTRAINT treatment_records_fdi CHECK(valid_fdi_tooth(tooth_number)) NOT VALID;

CREATE TABLE consultations (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), patient_id UUID NOT NULL REFERENCES patients(id),
 appointment_id UUID REFERENCES appointments(id), visit_date DATE NOT NULL DEFAULT current_date,
 chief_complaint TEXT NOT NULL CHECK(length(trim(chief_complaint)) > 0),
 examination TEXT NOT NULL CHECK(length(trim(examination)) > 0),
 diagnosis TEXT NOT NULL CHECK(length(trim(diagnosis)) > 0),
 treatment_performed TEXT NOT NULL CHECK(length(trim(treatment_performed)) > 0),
 next_visit_plan TEXT NOT NULL CHECK(length(trim(next_visit_plan)) > 0),
 history_reviewed BOOLEAN NOT NULL CHECK(history_reviewed), history_snapshot JSONB,
 reviewed_at TIMESTAMPTZ NOT NULL DEFAULT now(), recorded_by UUID NOT NULL REFERENCES staff(id),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE consultation_amendments (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), consultation_id UUID NOT NULL REFERENCES consultations(id),
 reason TEXT NOT NULL CHECK(length(trim(reason)) > 0), note TEXT NOT NULL CHECK(length(trim(note)) > 0),
 recorded_by UUID NOT NULL REFERENCES staff(id), created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE FUNCTION stamp_consultation() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 NEW.recorded_by := (SELECT id FROM staff WHERE user_id=auth.uid() AND active=true);
 NEW.created_at := now();
 IF TG_TABLE_NAME='consultations' THEN
  IF NEW.visit_date > current_date THEN RAISE EXCEPTION 'Visit date cannot be in the future'; END IF;
  IF NEW.appointment_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM appointments WHERE id=NEW.appointment_id AND patient_id=NEW.patient_id) THEN RAISE EXCEPTION 'Appointment belongs to a different patient'; END IF;
  NEW.reviewed_at := now();
  NEW.history_snapshot := (SELECT to_jsonb(m) FROM medical_history m WHERE patient_id=NEW.patient_id ORDER BY updated_at DESC, id LIMIT 1);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER stamp_consultation BEFORE INSERT ON consultations FOR EACH ROW EXECUTE FUNCTION stamp_consultation();
CREATE TRIGGER stamp_amendment BEFORE INSERT ON consultation_amendments FOR EACH ROW EXECUTE FUNCTION stamp_consultation();
ALTER TABLE consultations ENABLE ROW LEVEL SECURITY;
ALTER TABLE consultation_amendments ENABLE ROW LEVEL SECURITY;
CREATE POLICY consultation_read ON consultations FOR SELECT TO authenticated USING(current_staff_role() IS NOT NULL);
CREATE POLICY consultation_create ON consultations FOR INSERT TO authenticated WITH CHECK(current_staff_role() IN ('admin','doctor'));
CREATE POLICY amendment_read ON consultation_amendments FOR SELECT TO authenticated USING(current_staff_role() IS NOT NULL);
CREATE POLICY amendment_create ON consultation_amendments FOR INSERT TO authenticated WITH CHECK(current_staff_role() IN ('admin','doctor'));
-- No client UPDATE/DELETE policies: corrections are dated addenda.

-- A prescription contains one ordered list, saved atomically. Preserve legacy single-drug records.
ALTER TABLE prescriptions ADD COLUMN medicines JSONB;
UPDATE prescriptions SET medicines=jsonb_build_array(jsonb_build_object('name',medicine_name,'strength','','dose',coalesce(dosage,''),'frequency','','duration',coalesce(duration,''),'instructions',''));
CREATE FUNCTION validate_prescription() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE item JSONB;
BEGIN
 IF NEW.medicines IS NULL OR jsonb_typeof(NEW.medicines) <> 'array' OR jsonb_array_length(NEW.medicines) NOT BETWEEN 1 AND 30 THEN RAISE EXCEPTION 'Add 1–30 medicines'; END IF;
 FOR item IN SELECT * FROM jsonb_array_elements(NEW.medicines) LOOP
  IF coalesce(trim(item->>'name'),'')='' OR coalesce(trim(item->>'dose'),'')='' OR coalesce(trim(item->>'frequency'),'')='' OR coalesce(trim(item->>'duration'),'')='' THEN RAISE EXCEPTION 'Each medicine needs name, dose, frequency and duration'; END IF;
 END LOOP;
 IF NEW.prescribed_by IS NULL OR NOT EXISTS(SELECT 1 FROM staff WHERE id=NEW.prescribed_by AND active AND role IN ('doctor','admin')) THEN RAISE EXCEPTION 'Choose an active prescribing clinician'; END IF;
 NEW.medicine_name := NEW.medicines->0->>'name';
 NEW.dosage := NEW.medicines->0->>'dose'; NEW.duration := NEW.medicines->0->>'duration';
 RETURN NEW;
END $$;
CREATE TRIGGER validate_prescription BEFORE INSERT OR UPDATE OF medicines, prescribed_by ON prescriptions FOR EACH ROW EXECUTE FUNCTION validate_prescription();

ALTER TABLE invoices ADD COLUMN items JSONB;
ALTER TABLE invoices ADD COLUMN source_plan_id UUID REFERENCES treatment_plans(id);
CREATE FUNCTION calculate_invoice_items() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE item JSONB; qty NUMERIC; price NUMERIC; discount NUMERIC; tax NUMERIC; net NUMERIC; subtotal NUMERIC:=0; taxes NUMERIC:=0;
BEGIN
 IF NEW.items IS NULL THEN RETURN NEW; END IF; -- legacy invoices retain their original totals
 IF jsonb_typeof(NEW.items)<>'array' OR jsonb_array_length(NEW.items) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Add 1–100 invoice lines'; END IF;
 FOR item IN SELECT * FROM jsonb_array_elements(NEW.items) LOOP
  qty:=(item->>'quantity')::numeric; price:=(item->>'unit_price')::numeric; discount:=(item->>'discount')::numeric; tax:=(item->>'tax_rate')::numeric;
  IF coalesce(trim(item->>'description'),'')='' OR qty IS NULL OR qty<=0 OR qty>10000 OR qty<>round(qty,2) OR price IS NULL OR price<0 OR price>100000000 OR price<>round(price,2) OR discount IS NULL OR discount<0 OR discount>round(qty*price,2) OR discount<>round(discount,2) OR tax IS NULL OR tax<0 OR tax>100 OR tax<>round(tax,2) THEN RAISE EXCEPTION 'Invalid invoice line, quantity, price, discount or tax'; END IF;
  IF NOT valid_fdi_tooth(nullif(item->>'tooth_number','')::integer) THEN RAISE EXCEPTION 'Invalid FDI tooth'; END IF;
  IF nullif(item->>'treatment_record_id','') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM treatment_records WHERE id=(item->>'treatment_record_id')::uuid AND patient_id=NEW.patient_id AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Treatment record does not belong to this patient'; END IF;
  net:=round(qty*price,2)-discount; subtotal:=subtotal+net; taxes:=taxes+round(net*tax/100,2);
 END LOOP;
 IF NEW.source_plan_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM treatment_plans WHERE id=NEW.source_plan_id AND patient_id=NEW.patient_id AND patient_approved AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Choose an approved plan for this patient'; END IF;
 IF subtotal+taxes<=0 THEN RAISE EXCEPTION 'Invoice total must be positive'; END IF;
 NEW.amount:=subtotal; NEW.tax_amount:=taxes;
 RETURN NEW;
END $$;
CREATE TRIGGER calculate_invoice_items BEFORE INSERT OR UPDATE OF items, amount, tax_amount, patient_id, source_plan_id ON invoices FOR EACH ROW EXECUTE FUNCTION calculate_invoice_items();
-- Once issued, changing charges would rewrite the payment basis. Create a correcting invoice instead.
CREATE FUNCTION freeze_invoice_charges() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.items IS NOT NULL AND (NEW.items IS DISTINCT FROM OLD.items OR NEW.source_plan_id IS DISTINCT FROM OLD.source_plan_id OR NEW.amount IS DISTINCT FROM OLD.amount OR NEW.tax_amount IS DISTINCT FROM OLD.tax_amount) THEN RAISE EXCEPTION 'Issued invoice charges cannot be edited'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER freeze_invoice_charges BEFORE UPDATE ON invoices FOR EACH ROW EXECUTE FUNCTION freeze_invoice_charges();

CREATE TABLE consent_templates (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), procedure TEXT NOT NULL CHECK(length(trim(procedure))>0),
 statement TEXT NOT NULL CHECK(length(trim(statement))>0), approved_by UUID NOT NULL REFERENCES staff(id), created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE consent_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY consent_template_read ON consent_templates FOR SELECT TO authenticated USING(current_staff_role() IS NOT NULL);
CREATE POLICY consent_template_create ON consent_templates FOR INSERT TO authenticated WITH CHECK(current_staff_role() IN ('doctor','admin'));
CREATE FUNCTION stamp_consent_template() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN NEW.approved_by:=(SELECT id FROM staff WHERE user_id=auth.uid() AND active); NEW.created_at:=now(); RETURN NEW; END $$;
CREATE TRIGGER stamp_consent_template BEFORE INSERT ON consent_templates FOR EACH ROW EXECUTE FUNCTION stamp_consent_template();
ALTER TABLE consent_forms ADD COLUMN statement TEXT;
ALTER TABLE consent_forms ADD COLUMN template_id UUID REFERENCES consent_templates(id);
ALTER TABLE consent_forms ADD COLUMN signer_kind TEXT CHECK(signer_kind IN ('patient','guardian'));
ALTER TABLE consent_forms ADD COLUMN signer_name TEXT;
ALTER TABLE consent_forms ADD COLUMN guardian_relationship TEXT;
ALTER TABLE consent_forms ADD COLUMN recorded_by UUID REFERENCES staff(id);
CREATE FUNCTION validate_consent_evidence() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE dob DATE;
BEGIN
 IF TG_OP='UPDATE' AND OLD.consent_given THEN
  IF (to_jsonb(NEW)-'deleted_at'-'patient_id') IS DISTINCT FROM (to_jsonb(OLD)-'deleted_at'-'patient_id') THEN RAISE EXCEPTION 'Signed consent cannot be rewritten; create a new form'; END IF;
  RETURN NEW;
 END IF;
 IF NEW.template_id IS NOT NULL THEN
  SELECT statement, procedure INTO NEW.statement, NEW.procedure FROM consent_templates WHERE id=NEW.template_id;
 END IF;
 IF NEW.consent_given THEN
  IF coalesce(trim(NEW.statement),'')='' THEN RAISE EXCEPTION 'Record the procedure-specific consent statement'; END IF;
  IF coalesce(NEW.signature_data,'') !~ '^data:image/png;base64,.+' AND coalesce(NEW.document_url,'') !~ '^https://[^[:space:]]+$' THEN RAISE EXCEPTION 'Capture a signature or provide an HTTPS link to the signed document'; END IF;
  IF NEW.signer_kind IS NULL OR coalesce(trim(NEW.signer_name),'')='' THEN RAISE EXCEPTION 'Record who signed'; END IF;
  SELECT date_of_birth INTO dob FROM patients WHERE id=NEW.patient_id;
  IF dob > (current_date - interval '18 years')::date AND NEW.signer_kind <> 'guardian' THEN RAISE EXCEPTION 'Record guardian consent for a minor'; END IF;
  IF NEW.signer_kind='guardian' AND coalesce(trim(NEW.guardian_relationship),'')='' THEN RAISE EXCEPTION 'Guardian relationship required'; END IF;
  NEW.signed_date:=now(); NEW.recorded_by:=(SELECT id FROM staff WHERE user_id=auth.uid() AND active);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER validate_consent_evidence BEFORE INSERT OR UPDATE ON consent_forms FOR EACH ROW EXECUTE FUNCTION validate_consent_evidence();

-- Database-level restrictions, including direct API calls; active staff still read these records.
DO $$ DECLARE t TEXT; op TEXT; BEGIN
 FOREACH t IN ARRAY ARRAY['medical_history','tooth_chart','prescriptions','treatment_records','treatment_plans','treatment_plan_stages','periodontal_exams','periodontal_readings','plan_templates','plan_template_stages','consent_forms'] LOOP
  FOREACH op IN ARRAY ARRAY['INSERT','UPDATE','DELETE'] LOOP
   IF op='INSERT' THEN EXECUTE format('CREATE POLICY clinical_insert ON %I AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (current_staff_role() IN (''doctor'',''admin''))',t);
   ELSIF op='UPDATE' THEN EXECUTE format('CREATE POLICY clinical_update ON %I AS RESTRICTIVE FOR UPDATE TO authenticated USING (current_staff_role() IN (''doctor'',''admin'')) WITH CHECK (current_staff_role() IN (''doctor'',''admin''))',t);
   ELSE EXECUTE format('CREATE POLICY clinical_delete ON %I AS RESTRICTIVE FOR DELETE TO authenticated USING (current_staff_role() IN (''doctor'',''admin''))',t); END IF;
  END LOOP;
 END LOOP;
END $$;
CREATE FUNCTION mark_followup_called(p_id UUID) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF current_staff_role() IS NULL THEN RAISE EXCEPTION 'Active staff required'; END IF;
 UPDATE treatment_records SET follow_up_required=false WHERE id=p_id AND deleted_at IS NULL;
END $$;
REVOKE ALL ON FUNCTION mark_followup_called(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mark_followup_called(UUID) TO authenticated;
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
  UPDATE patients SET family_head_id = primary_id WHERE family_head_id = duplicate_id;

  UPDATE patients SET merged_into = primary_id WHERE id = duplicate_id;
END;
$$;

COMMIT;
