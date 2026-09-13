-- 012: require every authenticated database caller to be linked to an active
-- staff record. Existing role-specific restrictions (admin-only staff changes
-- and admin/doctor deletes) remain unchanged.

DO $$
DECLARE
  p RECORD;
  active_staff TEXT := '(current_staff_role() IS NOT NULL)';
BEGIN
  FOR p IN
    SELECT schemaname, tablename, policyname, cmd, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public'
      AND 'authenticated' = ANY(roles)
  LOOP
    -- Only replace permissive TRUE expressions. Role-specific expressions are
    -- intentionally preserved.
    IF p.cmd IN ('SELECT', 'DELETE') AND p.qual = 'true' THEN
      EXECUTE format('ALTER POLICY %I ON %I.%I USING (%s)',
        p.policyname, p.schemaname, p.tablename, active_staff);
    ELSIF p.cmd = 'INSERT' AND p.with_check = 'true' THEN
      EXECUTE format('ALTER POLICY %I ON %I.%I WITH CHECK (%s)',
        p.policyname, p.schemaname, p.tablename, active_staff);
    ELSIF p.cmd IN ('UPDATE', 'ALL') THEN
      IF p.qual = 'true' AND p.with_check = 'true' THEN
        EXECUTE format('ALTER POLICY %I ON %I.%I USING (%s) WITH CHECK (%s)',
          p.policyname, p.schemaname, p.tablename, active_staff, active_staff);
      ELSIF p.qual = 'true' THEN
        EXECUTE format('ALTER POLICY %I ON %I.%I USING (%s)',
          p.policyname, p.schemaname, p.tablename, active_staff);
      ELSIF p.with_check = 'true' THEN
        EXECUTE format('ALTER POLICY %I ON %I.%I WITH CHECK (%s)',
          p.policyname, p.schemaname, p.tablename, active_staff);
      END IF;
    END IF;
  END LOOP;
END $$;
