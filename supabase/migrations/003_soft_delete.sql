-- 003: soft delete — trash/restore instead of permanent loss on the one-click
-- delete buttons added across treatment plans, records, x-rays, lab orders,
-- referrals, consent forms, and insurance claims.
ALTER TABLE xray_images ADD COLUMN deleted_at TIMESTAMPTZ;
ALTER TABLE treatment_plans ADD COLUMN deleted_at TIMESTAMPTZ;
ALTER TABLE treatment_records ADD COLUMN deleted_at TIMESTAMPTZ;
ALTER TABLE lab_orders ADD COLUMN deleted_at TIMESTAMPTZ;
ALTER TABLE referrals ADD COLUMN deleted_at TIMESTAMPTZ;
ALTER TABLE consent_forms ADD COLUMN deleted_at TIMESTAMPTZ;
ALTER TABLE insurance_claims ADD COLUMN deleted_at TIMESTAMPTZ;
