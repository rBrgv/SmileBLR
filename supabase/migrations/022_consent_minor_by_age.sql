-- The guardian-consent check in 017 reads date_of_birth, which the clinic does
-- not collect: 7 patients have one, 650 have only an age. A NULL comparison is
-- never true, so every one of those minors could sign their own consent form.
--
-- Fall back to the recorded age, aged forward from the day it was taken. That
-- figure is a lower bound — someone showing as 17 is 17 or 18 — so treating
-- "under 18" as a minor asks for a guardian at most a year too long, which is
-- the safe direction.
BEGIN;

CREATE OR REPLACE FUNCTION validate_consent_evidence() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE dob DATE; rec_age INT; rec_on DATE; minor BOOLEAN;
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

  SELECT date_of_birth, approx_age, approx_age_recorded_on INTO dob, rec_age, rec_on
    FROM patients WHERE id=NEW.patient_id;
  minor := CASE
    WHEN dob IS NOT NULL THEN dob > (current_date - interval '18 years')::date
    WHEN rec_age IS NOT NULL AND rec_on IS NOT NULL
      THEN rec_age + floor((current_date - rec_on) / 365.25) < 18
    ELSE false                      -- age unknown; the form still records who signed
  END;
  IF minor AND NEW.signer_kind <> 'guardian' THEN RAISE EXCEPTION 'Record guardian consent for a minor'; END IF;

  IF NEW.signer_kind='guardian' AND coalesce(trim(NEW.guardian_relationship),'')='' THEN RAISE EXCEPTION 'Guardian relationship required'; END IF;
  NEW.signed_date:=now(); NEW.recorded_by:=(SELECT id FROM staff WHERE user_id=auth.uid() AND active);
 END IF;
 RETURN NEW;
END $$;

COMMIT;
