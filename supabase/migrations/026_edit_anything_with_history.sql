-- The clinic wants what Click4Appointment gave them: nothing locked, every
-- screen editable, staff never stuck. 016 and 017 had taken the opposite line
-- — issued invoice charges frozen, signed consent unrewritable, payments only
-- through a function — which is safe but blocks reception at the counter.
--
-- So the locks come off, and every edit writes down what it replaced instead.
-- An edit is allowed and immediate; the previous version is kept whether or
-- not anyone remembers to note it. That is what makes "edit anything" safe to
-- live with: a disputed invoice or consent form can still be reconstructed.
--
-- Role limits are untouched: clinical writes remain doctor and admin, which
-- is the clinic's own requirement, not a lock on editing.
BEGIN;

CREATE TABLE record_changes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name TEXT NOT NULL,
  record_id UUID NOT NULL,
  changed_by UUID REFERENCES auth.users(id),
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  old_row JSONB NOT NULL,
  new_row JSONB NOT NULL
);
CREATE INDEX record_changes_record ON record_changes(table_name, record_id, changed_at DESC);

ALTER TABLE record_changes ENABLE ROW LEVEL SECURITY;
-- Staff may read the history; nobody may write or tidy it. There is no
-- permissive policy for insert, update or delete, so those are denied
-- outright, while the trigger below writes as the table owner.
CREATE POLICY record_changes_read ON record_changes FOR SELECT TO authenticated USING (current_staff_role() IS NOT NULL);

CREATE FUNCTION log_record_change() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD) THEN
    INSERT INTO record_changes(table_name, record_id, changed_by, old_row, new_row)
    VALUES(TG_TABLE_NAME, OLD.id, auth.uid(), to_jsonb(OLD), to_jsonb(NEW));
  END IF;
  RETURN NEW;
END $$;

DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['patients','invoices','consent_forms','consultations','prescriptions',
                           'treatment_records','treatment_plans','treatment_plan_stages','appointments'] LOOP
    EXECUTE format('CREATE TRIGGER log_changes AFTER UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION log_record_change()', t);
  END LOOP;
END $$;

-- 1. Invoice charges: editable again, including on a paid invoice. The
--    trigger that recalculated totals from the line items stays, so an edited
--    invoice still adds up; only the refusal goes.
DROP TRIGGER IF EXISTS freeze_invoice_charges ON invoices;
DROP FUNCTION IF EXISTS freeze_invoice_charges();

-- 2. Payments: record_invoice_payment() remains the path the screens use,
--    because it keeps the running audit and the version check. But a direct
--    correction is no longer refused.
DROP TRIGGER IF EXISTS protect_invoice_payment ON invoices;
DROP FUNCTION IF EXISTS protect_invoice_payment();

-- 2b. Editing a paid invoice downwards left the amount already received above
--     the new total, which 016 refused outright — the very correction staff
--     make when a patient was overcharged. Received may now exceed the total;
--     the difference is money the clinic owes back, and the screens show it as
--     a credit rather than a negative balance.
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoice_paid_range;
ALTER TABLE invoices ADD CONSTRAINT invoice_paid_range CHECK(amount_paid IS NULL OR amount_paid >= 0);

CREATE OR REPLACE FUNCTION record_invoice_payment(p_id UUID, p_amount NUMERIC, p_refunded BOOLEAN, p_method TEXT, p_note TEXT, p_version INTEGER)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE inv invoices; next_status TEXT; total NUMERIC;
BEGIN
  IF current_staff_role() IS NULL THEN RAISE EXCEPTION 'Active staff required'; END IF;
  SELECT * INTO inv FROM invoices WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invoice not found'; END IF;
  IF inv.payment_version IS DISTINCT FROM p_version THEN RAISE EXCEPTION 'Payment changed by another staff member. Reload before saving.'; END IF;
  IF p_amount IS NULL OR p_amount < 0 OR p_amount <> round(p_amount,2) THEN RAISE EXCEPTION 'Invalid received amount'; END IF;
  IF nullif(trim(p_note),'') IS NULL THEN RAISE EXCEPTION 'Payment note required'; END IF;
  IF p_refunded AND p_amount <> 0 THEN RAISE EXCEPTION 'A fully refunded invoice must have zero net received'; END IF;
  total := inv.amount + coalesce(inv.tax_amount,0);
  next_status := CASE WHEN p_refunded THEN 'refunded' WHEN p_amount = 0 THEN 'pending'
                      WHEN p_amount >= total THEN 'paid' ELSE 'partial' END;
  INSERT INTO invoice_payment_changes(invoice_id, old_amount, new_amount, old_status, new_status, payment_method, note, changed_by)
  VALUES(p_id, inv.amount_paid, p_amount, inv.payment_status, next_status, p_method, p_note, auth.uid());
  UPDATE invoices SET amount_paid = p_amount, payment_status = next_status, payment_method = p_method, payment_version = payment_version + 1 WHERE id = p_id;
END $$;

-- 3. Consent: a signed form can be corrected rather than only replaced. The
--    evidence rules still apply — statement, signature, who signed, guardian
--    for a minor — they are just no longer frozen after the first save.
CREATE OR REPLACE FUNCTION validate_consent_evidence() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE dob DATE; rec_age INT; rec_on DATE; minor BOOLEAN;
BEGIN
 IF NEW.template_id IS NOT NULL AND (TG_OP='INSERT' OR NEW.template_id IS DISTINCT FROM OLD.template_id) THEN
  SELECT statement, procedure INTO NEW.statement, NEW.procedure FROM consent_templates WHERE id=NEW.template_id;
 END IF;
 IF NEW.consent_given THEN
  IF coalesce(trim(NEW.statement),'')='' THEN RAISE EXCEPTION 'Record the procedure-specific consent statement'; END IF;
  IF coalesce(NEW.signature_data,'') !~ '^data:image/png;base64,.+' AND coalesce(NEW.document_url,'') !~ '^https://[^[:space:]]+$' THEN RAISE EXCEPTION 'Capture a signature or provide an HTTPS link to the signed document'; END IF;
  IF NEW.signer_kind IS NULL OR coalesce(trim(NEW.signer_name),'')='' THEN RAISE EXCEPTION 'Record who signed'; END IF;

  SELECT date_of_birth, approx_age, approx_age_recorded_on INTO dob, rec_age, rec_on
    FROM patients WHERE id=NEW.patient_id;
  minor := CASE
    WHEN dob IS NOT NULL THEN dob > (current_date - interval '18 years')::date
    WHEN rec_age IS NOT NULL AND rec_on IS NOT NULL
      THEN rec_age + floor((current_date - rec_on) / 365.25) < 18
    ELSE false
  END;
  IF minor AND NEW.signer_kind <> 'guardian' THEN RAISE EXCEPTION 'Record guardian consent for a minor'; END IF;
  IF NEW.signer_kind='guardian' AND coalesce(trim(NEW.guardian_relationship),'')='' THEN RAISE EXCEPTION 'Guardian relationship required'; END IF;

  -- Stamp the signing only the first time, so an edit does not silently
  -- re-date a consent the patient gave weeks ago.
  IF TG_OP='INSERT' OR NOT OLD.consent_given THEN
   NEW.signed_date:=now(); NEW.recorded_by:=(SELECT id FROM staff WHERE user_id=auth.uid() AND active);
  END IF;
 END IF;
 RETURN NEW;
END $$;

-- 4. Consultations: correctable in place. Amendments stay available for a
--    deliberate addendum, but a typo no longer needs one.
CREATE POLICY consultation_update ON consultations FOR UPDATE TO authenticated
  USING (current_staff_role() IN ('admin','doctor')) WITH CHECK (current_staff_role() IN ('admin','doctor'));

-- The insert trigger re-stamped recorded_by and the history snapshot on every
-- write; on an edit that would overwrite who actually saw the patient.
DROP TRIGGER IF EXISTS stamp_consultation ON consultations;
CREATE TRIGGER stamp_consultation BEFORE INSERT ON consultations FOR EACH ROW EXECUTE FUNCTION stamp_consultation();

COMMIT;
