-- 014: campaign engine + clinic Free/Pro plan gating
--
-- Adds a singleton clinic_settings row (plan toggle, manual for now — no
-- billing integration exists yet), a campaigns table (arbitrary WhatsApp
-- bulk-send definitions, replacing the two hardcoded jobs in
-- send-reminders.js with something admins can define themselves), and
-- campaign_sends (per-patient-per-day send log + dedupe, same shape as
-- recall_reminders.reminder_sent).

-- ── CLINIC SETTINGS (singleton) ──
CREATE TABLE clinic_settings (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  plan TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'pro')),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
INSERT INTO clinic_settings (id, plan) VALUES (1, 'free');

-- ── CAMPAIGNS ──
CREATE TABLE campaigns (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  audience TEXT NOT NULL CHECK (audience IN ('recall_due', 'pending_payment', 'upcoming_appointment', 'custom_tag')),
  audience_tag TEXT,               -- only used when audience = 'custom_tag'
  message_template TEXT NOT NULL,  -- human-readable body, shown in the UI
  wa_template_name TEXT,           -- Meta-approved WhatsApp template name actually sent
  schedule_cron TEXT,              -- recurring schedule; only honored when clinic_settings.plan = 'pro'
  active BOOLEAN DEFAULT TRUE,
  last_run_at TIMESTAMPTZ,
  created_by UUID REFERENCES staff(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── CAMPAIGN SENDS (log + per-day dedupe) ──
CREATE TABLE campaign_sends (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE,
  patient_id UUID REFERENCES patients(id) ON DELETE CASCADE,
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  status TEXT NOT NULL CHECK (status IN ('sent', 'failed', 'skipped')),
  error TEXT
);
CREATE INDEX campaign_sends_dedupe ON campaign_sends (campaign_id, patient_id, (sent_at::date));

-- ── RLS: admin-only, same pattern as staff/activity_log ──
ALTER TABLE clinic_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_sends ENABLE ROW LEVEL SECURITY;

CREATE POLICY "clinic_settings_admin_select" ON clinic_settings FOR SELECT TO authenticated USING (current_staff_role() = 'admin');
CREATE POLICY "clinic_settings_admin_update" ON clinic_settings FOR UPDATE TO authenticated USING (current_staff_role() = 'admin');

CREATE POLICY "campaigns_admin_all" ON campaigns FOR ALL TO authenticated
  USING (current_staff_role() = 'admin') WITH CHECK (current_staff_role() = 'admin');

CREATE POLICY "campaign_sends_admin_select" ON campaign_sends FOR SELECT TO authenticated USING (current_staff_role() = 'admin');
