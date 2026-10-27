-- Apply before deploying the handoff UI. All changes are transactional.
BEGIN;
ALTER TABLE patients ADD COLUMN import_key TEXT;
ALTER TABLE patients ADD COLUMN import_source JSONB;
ALTER TABLE patients ALTER COLUMN phone DROP NOT NULL;
CREATE UNIQUE INDEX patients_import_key_unique ON patients(import_key) WHERE import_key IS NOT NULL;

-- One CSV row is one transaction: patient + medical history succeed together.
-- A stable source ID (or client-computed row fingerprint) makes retries safe.
CREATE FUNCTION import_patient(p_key TEXT, p_patient JSONB, p_medical JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p patients; m medical_history; existing_id UUID; new_id UUID;
BEGIN
  IF current_staff_role() IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'Admin access required'; END IF;
  IF p_key IS NULL OR length(p_key) < 5 THEN RAISE EXCEPTION 'Import key required'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_key, 0));
  SELECT id INTO existing_id FROM patients WHERE import_key = p_key;
  IF existing_id IS NOT NULL THEN
    IF (SELECT import_source FROM patients WHERE id = existing_id) IS DISTINCT FROM p_patient->'import_source' THEN RAISE EXCEPTION 'Source record changed since import; review changes manually'; END IF;
    RETURN jsonb_build_object('id', existing_id, 'status', 'already_imported');
  END IF;
  p := jsonb_populate_record(NULL::patients, p_patient);
  IF nullif(trim(p.full_name), '') IS NULL THEN RAISE EXCEPTION 'Name required'; END IF;
  IF nullif(trim(p.phone), '') IS NOT NULL THEN PERFORM pg_advisory_xact_lock(hashtextextended(lower(trim(p.full_name)) || regexp_replace(p.phone, '\D', '', 'g'), 1)); END IF;
  -- Do not automatically merge shared household numbers or overwrite existing records.
  IF p.phone IS NULL AND EXISTS (SELECT 1 FROM patients WHERE merged_into IS NULL AND lower(trim(full_name)) = lower(trim(p.full_name)) AND (phone IS NULL OR phone = 'N/A')) THEN RAISE EXCEPTION 'Matching patient without a phone already exists; review this row'; END IF;
  IF EXISTS (SELECT 1 FROM patients WHERE merged_into IS NULL AND lower(trim(full_name)) = lower(trim(p.full_name)) AND regexp_replace(phone, '\D', '', 'g') = regexp_replace(p.phone, '\D', '', 'g')) THEN
    RAISE EXCEPTION 'Matching name and phone already exist; review this row before importing';
  END IF;
  INSERT INTO patients(full_name, phone, email, date_of_birth, gender, address, emergency_contact_name, emergency_contact_phone, consent_given, consent_date, referral_source, tags, import_key, import_source)
  VALUES(p.full_name, p.phone, p.email, p.date_of_birth, p.gender, p.address, p.emergency_contact_name, p.emergency_contact_phone, coalesce(p.consent_given,false), p.consent_date, p.referral_source, coalesce(p.tags,'{}'), p_key, p.import_source) RETURNING id INTO new_id;
  IF p_medical IS NOT NULL AND p_medical <> 'null'::jsonb THEN
    m := jsonb_populate_record(NULL::medical_history, p_medical);
    INSERT INTO medical_history(patient_id, condition, allergies, current_medications, pregnancy_status, notes)
    VALUES(new_id, m.condition, m.allergies, m.current_medications, m.pregnancy_status, m.notes);
  END IF;
  RETURN jsonb_build_object('id', new_id, 'status', 'imported');
END $$;
REVOKE ALL ON FUNCTION import_patient(TEXT, JSONB, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION import_patient(TEXT, JSONB, JSONB) TO authenticated;

-- NULL identifies legacy partial payments whose received amount is unknown.
ALTER TABLE invoices ADD COLUMN amount_paid NUMERIC(12,2);
ALTER TABLE invoices ADD COLUMN payment_version INTEGER NOT NULL DEFAULT 0;
UPDATE invoices SET amount_paid = CASE WHEN payment_status = 'paid' THEN amount + coalesce(tax_amount,0) WHEN payment_status = 'partial' THEN NULL ELSE 0 END;
ALTER TABLE invoices ALTER COLUMN amount_paid SET DEFAULT 0;
ALTER TABLE invoices ADD CONSTRAINT invoice_paid_range CHECK(amount_paid IS NULL OR (amount_paid >= 0 AND amount_paid <= amount + coalesce(tax_amount,0)));
CREATE TABLE invoice_payment_changes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES invoices(id),
  old_amount NUMERIC, new_amount NUMERIC NOT NULL,
  old_status TEXT, new_status TEXT NOT NULL,
  payment_method TEXT, note TEXT NOT NULL,
  changed_by UUID REFERENCES auth.users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE invoice_payment_changes ENABLE ROW LEVEL SECURITY;
CREATE POLICY payment_changes_read ON invoice_payment_changes FOR SELECT TO authenticated USING(current_staff_role() IS NOT NULL);
-- Writes only through the function. Optimistic version check avoids lost updates.
CREATE FUNCTION record_invoice_payment(p_id UUID, p_amount NUMERIC, p_refunded BOOLEAN, p_method TEXT, p_note TEXT, p_version INTEGER)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE inv invoices; next_status TEXT;
BEGIN
  IF current_staff_role() IS NULL THEN RAISE EXCEPTION 'Active staff required'; END IF;
  SELECT * INTO inv FROM invoices WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invoice not found'; END IF;
  IF inv.payment_version IS DISTINCT FROM p_version THEN RAISE EXCEPTION 'Payment changed by another staff member. Reload before saving.'; END IF;
  IF p_amount IS NULL OR p_amount < 0 OR p_amount > inv.amount + coalesce(inv.tax_amount,0) OR p_amount <> round(p_amount,2) THEN RAISE EXCEPTION 'Invalid received amount'; END IF;
  IF nullif(trim(p_note),'') IS NULL THEN RAISE EXCEPTION 'Payment note required'; END IF;
  IF p_refunded AND p_amount <> 0 THEN RAISE EXCEPTION 'A fully refunded invoice must have zero net received'; END IF;
  next_status := CASE WHEN p_refunded THEN 'refunded' WHEN p_amount = 0 THEN 'pending' WHEN p_amount = inv.amount + coalesce(inv.tax_amount,0) THEN 'paid' ELSE 'partial' END;
  INSERT INTO invoice_payment_changes(invoice_id, old_amount, new_amount, old_status, new_status, payment_method, note, changed_by)
  VALUES(p_id, inv.amount_paid, p_amount, inv.payment_status, next_status, p_method, p_note, auth.uid());
  UPDATE invoices SET amount_paid = p_amount, payment_status = next_status, payment_method = p_method, payment_version = payment_version + 1 WHERE id = p_id;
END $$;
REVOKE ALL ON FUNCTION record_invoice_payment(UUID, NUMERIC, BOOLEAN, TEXT, TEXT, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION record_invoice_payment(UUID, NUMERIC, BOOLEAN, TEXT, TEXT, INTEGER) TO authenticated;

-- Prevent direct client updates from bypassing the payment audit function.
CREATE FUNCTION protect_invoice_payment() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF current_user IN ('anon', 'authenticated') THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.payment_status IS DISTINCT FROM 'pending' OR coalesce(NEW.amount_paid,0) <> 0 OR NEW.payment_version <> 0 THEN RAISE EXCEPTION 'Record payment through payment action'; END IF;
    ELSIF NEW.amount_paid IS DISTINCT FROM OLD.amount_paid OR NEW.payment_status IS DISTINCT FROM OLD.payment_status OR NEW.payment_version IS DISTINCT FROM OLD.payment_version THEN
      RAISE EXCEPTION 'Record payment through payment action';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER protect_invoice_payment BEFORE INSERT OR UPDATE ON invoices FOR EACH ROW EXECUTE FUNCTION protect_invoice_payment();
COMMIT;
