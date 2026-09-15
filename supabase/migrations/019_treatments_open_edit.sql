BEGIN;

-- Reverse course from 018: any staff can view/add/edit treatments.
-- Only deleting an existing procedure stays admin-only.
DROP POLICY IF EXISTS "staff_admin_update_treatments" ON treatments;

CREATE POLICY "staff_update_treatments" ON treatments FOR UPDATE TO authenticated USING (true);

COMMIT;
