BEGIN;

-- Treatment catalogue: any staff can view/add, but editing or removing an
-- existing procedure is admin-only (receptionists shouldn't be able to
-- change prices/durations other staff rely on).
DROP POLICY IF EXISTS "staff_all_treatments" ON treatments;

CREATE POLICY "staff_read_treatments" ON treatments FOR SELECT TO authenticated USING (true);
CREATE POLICY "staff_insert_treatments" ON treatments FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "staff_admin_update_treatments" ON treatments FOR UPDATE TO authenticated USING (current_staff_role() = 'admin');
CREATE POLICY "staff_admin_delete_treatments" ON treatments FOR DELETE TO authenticated USING (current_staff_role() = 'admin');

COMMIT;
