-- One-time data seed (not a schema migration) — adds the doctors from
-- click4appointment_doctors.csv that aren't already in `staff`.
-- Dr Prithvi Balepur and Dr Sanyukta Prithvi are skipped: they already exist
-- as staff rows (phone numbers differ slightly between the two systems, but
-- these are clearly the same two people already in the roster).
INSERT INTO staff (full_name, role, phone, active) VALUES
  ('Dr Anusha', 'doctor', '9164128048', true),
  ('Dr Manjunath', 'doctor', NULL, true),
  ('Dr Hema Latha J', 'doctor', '7892848282', true),
  ('Dr Vivek Aithal', 'doctor', '9632973966', true),
  ('Dr Akhilesh Sharma', 'doctor', '9986135337', true),
  ('Dr Ananth Krishna', 'doctor', '9886188230', true);
