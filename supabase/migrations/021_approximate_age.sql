-- Click4Appointment recorded an age, never a date of birth. An age is only
-- true on the day it was taken, so it is kept as an explicitly approximate
-- value with the date it was recorded, rather than being converted into an
-- invented birth date. date_of_birth stays empty until staff confirm a real
-- one with the patient.
BEGIN;

ALTER TABLE patients ADD COLUMN approx_age INT CHECK (approx_age IS NULL OR (approx_age >= 0 AND approx_age <= 120));
ALTER TABLE patients ADD COLUMN approx_age_recorded_on DATE;

-- An approximate age without its date cannot be aged forward, so require both.
ALTER TABLE patients ADD CONSTRAINT patients_approx_age_dated
  CHECK ((approx_age IS NULL) = (approx_age_recorded_on IS NULL));

COMMENT ON COLUMN patients.approx_age IS 'Age as recorded in the source system; superseded by date_of_birth once confirmed.';

COMMIT;
