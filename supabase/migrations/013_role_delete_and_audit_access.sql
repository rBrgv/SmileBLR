-- 013: align database enforcement with the role restrictions shown in the UI.
--
-- 1. Broad FOR ALL policies currently let every active staff member issue a
--    direct DELETE, even where the app hides permanent deletion.
-- 2. The activity-log page is admin-only, so its SELECT policy must be too.
--
-- Normal SELECT/INSERT/UPDATE access remains available to every active staff
-- role. DELETE becomes admin/doctor-only. Staff-table writes retain their
-- existing admin-only policies and are not touched here.

DO $$
DECLARE
  p RECORD;
  base_name TEXT;
BEGIN
  FOR p IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND cmd = 'ALL'
      AND 'authenticated' = ANY(roles)
      AND qual = '(current_staff_role() IS NOT NULL)'
      AND with_check = '(current_staff_role() IS NOT NULL)'
  LOOP
    base_name := p.policyname;

    EXECUTE format('DROP POLICY %I ON %I.%I',
      p.policyname, p.schemaname, p.tablename);

    EXECUTE format(
      'CREATE POLICY %I ON %I.%I FOR SELECT TO authenticated USING (current_staff_role() IS NOT NULL)',
      base_name || '_select', p.schemaname, p.tablename);
    EXECUTE format(
      'CREATE POLICY %I ON %I.%I FOR INSERT TO authenticated WITH CHECK (current_staff_role() IS NOT NULL)',
      base_name || '_insert', p.schemaname, p.tablename);
    EXECUTE format(
      'CREATE POLICY %I ON %I.%I FOR UPDATE TO authenticated USING (current_staff_role() IS NOT NULL) WITH CHECK (current_staff_role() IS NOT NULL)',
      base_name || '_update', p.schemaname, p.tablename);
    EXECUTE format(
      'CREATE POLICY %I ON %I.%I FOR DELETE TO authenticated USING (current_staff_role() IN (''admin'', ''doctor''))',
      base_name || '_delete', p.schemaname, p.tablename);
  END LOOP;
END $$;

DROP POLICY IF EXISTS "staff_select_activity_log" ON activity_log;
CREATE POLICY "staff_select_activity_log"
  ON activity_log FOR SELECT TO authenticated
  USING (current_staff_role() = 'admin');

