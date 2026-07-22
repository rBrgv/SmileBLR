-- 004: role-based access control
--
-- What this does:
--  1. Links each `staff` directory row to its Supabase Auth login (user_id).
--  2. Guarantees YOUR account is linked and set to 'admin' BEFORE any
--     restrictive policy is created — so this migration cannot lock you out
--     of your own app. (If you don't sign in with bhargavtaurus@gmail.com,
--     edit the email in step 2 first.)
--  3. Restricts exactly two things to trusted roles, and changes nothing else:
--       a) managing the staff roster (staff table insert/update/delete)
--       b) permanently deleting records (the "Delete permanently" action in
--          Trash, and treatment plan stage deletes — both irreversible)
--     Every other table keeps the same open read/write access all staff have
--     today; soft-delete ("move to trash", an UPDATE not a DELETE) is
--     untouched by this migration.
--
-- Safety note: this edits live RLS policies. If something here is wrong, the
-- app may stop letting some actions through for some users — but you are
-- never locked out at the infrastructure level, since the Supabase SQL
-- editor connects as the postgres role and always bypasses RLS. Worst case,
-- come back here and DROP the new policies to revert.

-- ============================================
-- 1) Link staff directory rows to auth logins
-- ============================================
ALTER TABLE staff ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) UNIQUE;

-- ============================================
-- 2) Make sure YOUR account is linked as admin first
-- ============================================
DO $$
DECLARE uid UUID;
BEGIN
  SELECT id INTO uid FROM auth.users WHERE email = 'bhargavtaurus@gmail.com';
  IF uid IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM staff WHERE user_id = uid) THEN
      UPDATE staff SET role = 'admin', active = true WHERE user_id = uid;
    ELSIF EXISTS (SELECT 1 FROM staff WHERE email = 'bhargavtaurus@gmail.com') THEN
      UPDATE staff SET user_id = uid, role = 'admin', active = true WHERE email = 'bhargavtaurus@gmail.com';
    ELSE
      INSERT INTO staff (full_name, role, email, user_id, active) VALUES ('Admin', 'admin', 'bhargavtaurus@gmail.com', uid, true);
    END IF;
  END IF;
END $$;

-- ============================================
-- 3) Helper: current signed-in user's staff role (NULL if not linked/inactive)
-- ============================================
CREATE OR REPLACE FUNCTION current_staff_role() RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role FROM staff WHERE user_id = auth.uid() AND active = true LIMIT 1
$$;

-- ============================================
-- 4) Staff roster — admin-only writes, viewing stays open to all staff
-- ============================================
DROP POLICY IF EXISTS "staff_all_staff" ON staff;
CREATE POLICY "staff_select_staff" ON staff FOR SELECT TO authenticated USING (true);
CREATE POLICY "staff_admin_insert_staff" ON staff FOR INSERT TO authenticated WITH CHECK (current_staff_role() = 'admin');
CREATE POLICY "staff_admin_update_staff" ON staff FOR UPDATE TO authenticated USING (current_staff_role() = 'admin');
CREATE POLICY "staff_admin_delete_staff" ON staff FOR DELETE TO authenticated USING (current_staff_role() = 'admin');

-- ============================================
-- 5) Permanent DELETE on soft-deletable tables — admin or doctor only.
--    SELECT/INSERT/UPDATE stay open to everyone (unchanged from before).
-- ============================================
DROP POLICY IF EXISTS "staff_all_treatment_plans" ON treatment_plans;
CREATE POLICY "staff_select_treatment_plans" ON treatment_plans FOR SELECT TO authenticated USING (true);
CREATE POLICY "staff_insert_treatment_plans" ON treatment_plans FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "staff_update_treatment_plans" ON treatment_plans FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "staff_delete_treatment_plans" ON treatment_plans FOR DELETE TO authenticated USING (current_staff_role() IN ('admin','doctor'));

DROP POLICY IF EXISTS "staff_all_treatment_plan_stages" ON treatment_plan_stages;
CREATE POLICY "staff_select_treatment_plan_stages" ON treatment_plan_stages FOR SELECT TO authenticated USING (true);
CREATE POLICY "staff_insert_treatment_plan_stages" ON treatment_plan_stages FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "staff_update_treatment_plan_stages" ON treatment_plan_stages FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "staff_delete_treatment_plan_stages" ON treatment_plan_stages FOR DELETE TO authenticated USING (current_staff_role() IN ('admin','doctor'));

DROP POLICY IF EXISTS "staff_all_treatment_records" ON treatment_records;
CREATE POLICY "staff_select_treatment_records" ON treatment_records FOR SELECT TO authenticated USING (true);
CREATE POLICY "staff_insert_treatment_records" ON treatment_records FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "staff_update_treatment_records" ON treatment_records FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "staff_delete_treatment_records" ON treatment_records FOR DELETE TO authenticated USING (current_staff_role() IN ('admin','doctor'));

DROP POLICY IF EXISTS "staff_all_xray_images" ON xray_images;
CREATE POLICY "staff_select_xray_images" ON xray_images FOR SELECT TO authenticated USING (true);
CREATE POLICY "staff_insert_xray_images" ON xray_images FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "staff_update_xray_images" ON xray_images FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "staff_delete_xray_images" ON xray_images FOR DELETE TO authenticated USING (current_staff_role() IN ('admin','doctor'));

DROP POLICY IF EXISTS "staff_all_lab_orders" ON lab_orders;
CREATE POLICY "staff_select_lab_orders" ON lab_orders FOR SELECT TO authenticated USING (true);
CREATE POLICY "staff_insert_lab_orders" ON lab_orders FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "staff_update_lab_orders" ON lab_orders FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "staff_delete_lab_orders" ON lab_orders FOR DELETE TO authenticated USING (current_staff_role() IN ('admin','doctor'));

DROP POLICY IF EXISTS "staff_all_referrals" ON referrals;
CREATE POLICY "staff_select_referrals" ON referrals FOR SELECT TO authenticated USING (true);
CREATE POLICY "staff_insert_referrals" ON referrals FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "staff_update_referrals" ON referrals FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "staff_delete_referrals" ON referrals FOR DELETE TO authenticated USING (current_staff_role() IN ('admin','doctor'));

DROP POLICY IF EXISTS "staff_all_consent_forms" ON consent_forms;
CREATE POLICY "staff_select_consent_forms" ON consent_forms FOR SELECT TO authenticated USING (true);
CREATE POLICY "staff_insert_consent_forms" ON consent_forms FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "staff_update_consent_forms" ON consent_forms FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "staff_delete_consent_forms" ON consent_forms FOR DELETE TO authenticated USING (current_staff_role() IN ('admin','doctor'));

DROP POLICY IF EXISTS "staff_all_insurance_claims" ON insurance_claims;
CREATE POLICY "staff_select_insurance_claims" ON insurance_claims FOR SELECT TO authenticated USING (true);
CREATE POLICY "staff_insert_insurance_claims" ON insurance_claims FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "staff_update_insurance_claims" ON insurance_claims FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "staff_delete_insurance_claims" ON insurance_claims FOR DELETE TO authenticated USING (current_staff_role() IN ('admin','doctor'));
