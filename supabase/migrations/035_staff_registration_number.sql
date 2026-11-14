-- The doctor's council registration number, printed on invoices so a patient
-- can claim from an insurer. Free text, entered as the council issued it
-- (for example "KSDC No: 15948-A"), because doctors can be registered with
-- different councils.
ALTER TABLE staff ADD COLUMN IF NOT EXISTS registration_number TEXT;
