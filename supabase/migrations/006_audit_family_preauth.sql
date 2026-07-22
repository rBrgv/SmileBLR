-- 006: audit trail, family/household linking, insurance pre-authorization.
-- Schema only, no RLS policy changes to existing tables — safe to run any time.

-- ============================================
-- Audit trail — curated, not a firehose. App code logs specific high-value
-- events (staff/role changes, permanent deletes, plan approval, consent
-- signing) rather than every mutation, so it stays readable.
-- ============================================
CREATE TABLE IF NOT EXISTS activity_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  actor_id UUID REFERENCES staff(id),
  action TEXT NOT NULL,           -- e.g. 'staff.role_changed', 'trash.purged'
  entity_type TEXT,               -- e.g. 'patient', 'treatment_plan'
  entity_id UUID,
  summary TEXT NOT NULL,          -- human-readable one-liner
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE activity_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "staff_select_activity_log" ON activity_log;
CREATE POLICY "staff_select_activity_log" ON activity_log FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "staff_insert_activity_log" ON activity_log;
CREATE POLICY "staff_insert_activity_log" ON activity_log FOR INSERT TO authenticated WITH CHECK (true);
-- No UPDATE/DELETE policy on purpose — an audit log that can be edited or
-- erased by the same roles it's meant to hold accountable isn't an audit log.

-- ============================================
-- Family / household linking — a patient can point at another patient as
-- their "household head"; family members are everyone sharing that head.
-- ============================================
ALTER TABLE patients ADD COLUMN IF NOT EXISTS family_head_id UUID REFERENCES patients(id);

-- ============================================
-- Insurance pre-authorization — same table as claims (same fields apply),
-- distinguished by claim_type. An approved pre-authorization gets "filed"
-- into a separate post-treatment claim row once treatment is done.
-- ============================================
ALTER TABLE insurance_claims ADD COLUMN IF NOT EXISTS claim_type TEXT CHECK (claim_type IN ('pre_authorization','claim')) DEFAULT 'claim';
