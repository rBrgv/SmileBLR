-- ============================================
-- DENTIST-ORIENTED GAPS — recall interval, sterilization logging
-- (allergy banners, prescription warnings, post-op instructions and the
-- daily follow-up-call panel are all built on existing columns — no
-- schema changes needed for those.)
-- ============================================

-- ── PER-PATIENT RECALL INTERVAL ──
-- Perio-maintenance patients need a 3-month recall, not the default 6.
ALTER TABLE patients ADD COLUMN IF NOT EXISTS recall_interval_months INT DEFAULT 6;

-- ── STERILIZATION / AUTOCLAVE CYCLE LOGGING ──
-- Reuses compliance_logs (already has date/next-due/performed-by/vendor)
-- instead of a parallel table — just a new log_type plus a pass/fail
-- indicator result column specific to sterilization cycles.
ALTER TABLE compliance_logs DROP CONSTRAINT IF EXISTS compliance_logs_log_type_check;
ALTER TABLE compliance_logs ADD CONSTRAINT compliance_logs_log_type_check
  CHECK (log_type IN ('biomedical_waste', 'equipment_maintenance', 'sterilization'));
ALTER TABLE compliance_logs ADD COLUMN IF NOT EXISTS indicator_result TEXT CHECK (indicator_result IN ('pass', 'fail'));
