-- Staff can be edited now, which includes changing a role or switching someone
-- off. An admin who edits themselves out, or deactivates the only other admin,
-- would leave a clinic nobody can administer: no one to add staff, link a
-- login or change settings, with the fix needing a database console.
--
-- So the last active admin who can sign in cannot be demoted, deactivated,
-- unlinked or deleted until someone else holds that role.
--
-- Role and contact changes also keep the version they replaced, like every
-- other record since 026, so "who made this person an admin" has an answer.
BEGIN;

CREATE FUNCTION protect_last_admin() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.role = 'admin' AND OLD.active AND OLD.user_id IS NOT NULL
     AND (TG_OP = 'DELETE' OR NEW.role IS DISTINCT FROM 'admin' OR NOT coalesce(NEW.active, false) OR NEW.user_id IS NULL) THEN
    IF NOT EXISTS (SELECT 1 FROM staff WHERE role = 'admin' AND active AND user_id IS NOT NULL AND id <> OLD.id) THEN
      RAISE EXCEPTION 'Keep at least one active admin who can sign in. Make someone else an admin first.';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER protect_last_admin BEFORE UPDATE OR DELETE ON staff FOR EACH ROW EXECUTE FUNCTION protect_last_admin();
CREATE TRIGGER log_changes AFTER UPDATE ON staff FOR EACH ROW EXECUTE FUNCTION log_record_change();

COMMIT;
