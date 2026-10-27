-- Read only. Run before migration 016 and before handoff.
SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;
SELECT column_name, data_type FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'invoices' ORDER BY ordinal_position;
SELECT role, active, count(*) AS staff_count, count(user_id) AS linked_logins FROM staff GROUP BY role, active ORDER BY role, active;
SELECT count(*) AS patient_count,
 count(*) FILTER (WHERE phone IS NULL OR trim(phone) IN ('', 'N/A')) AS missing_phone,
 count(*) FILTER (WHERE merged_into IS NOT NULL) AS merged_records FROM patients;
SELECT payment_status, count(*) AS invoices, sum(amount + coalesce(tax_amount,0)) AS invoice_total_including_tax
FROM invoices GROUP BY payment_status ORDER BY payment_status;
SELECT count(*) AS invalid_invoices FROM invoices
WHERE amount < 0 OR coalesce(tax_amount,0) < 0 OR amount::text IN ('NaN','Infinity','-Infinity') OR tax_amount::text IN ('NaN','Infinity','-Infinity');
SELECT count(*) AS upcoming_appointments FROM appointments WHERE appointment_time >= now() AND status NOT IN ('cancelled','no_show');
SELECT tablename, policyname, cmd, roles, qual, with_check FROM pg_policies WHERE schemaname = 'public' ORDER BY tablename, policyname;
SELECT routine_name FROM information_schema.routines WHERE routine_schema='public' AND routine_name IN ('current_staff_role','import_patient','record_invoice_payment') ORDER BY routine_name;
