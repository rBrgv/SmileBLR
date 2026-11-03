-- Patients were the one record with no way out: merge existed for genuine
-- duplicates, but a test entry or a patient registered twice under different
-- spellings had to stay forever. Archiving follows the same trash-and-restore
-- pattern as 003, so an invoice never points at a patient who vanished.
--
-- Archiving is deliberately blocked while a patient still has money or
-- clinical history attached — those should be merged, not hidden.
BEGIN;

ALTER TABLE patients ADD COLUMN deleted_at TIMESTAMPTZ;

CREATE FUNCTION archive_patient(p_id UUID) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n INT;
BEGIN
  IF current_staff_role() <> 'admin' THEN RAISE EXCEPTION 'Only an admin can archive a patient'; END IF;

  SELECT count(*) INTO n FROM invoices WHERE patient_id = p_id;
  IF n > 0 THEN RAISE EXCEPTION 'This patient has % invoice(s). Merge them into the right patient instead.', n; END IF;

  SELECT count(*) INTO n FROM treatment_records WHERE patient_id = p_id AND deleted_at IS NULL;
  IF n > 0 THEN RAISE EXCEPTION 'This patient has % treatment record(s). Merge them into the right patient instead.', n; END IF;

  UPDATE patients SET deleted_at = now() WHERE id = p_id AND deleted_at IS NULL;
END $$;
REVOKE ALL ON FUNCTION archive_patient(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION archive_patient(UUID) TO authenticated;

COMMIT;
