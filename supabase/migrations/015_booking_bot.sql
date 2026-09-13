-- 015: conversational WhatsApp booking bot
--
-- Extends clinic_settings with the config the bot needs (off by default —
-- booking_bot_enabled stays false until Meta + OpenAI creds are actually
-- configured, so a half-set-up bot never goes live by accident), and adds
-- two tables: wa_conversations (persisted OpenAI message history, since
-- Vercel serverless functions are stateless between invocations — there is
-- no in-memory option here) and wa_messages (audit log, no dashboard UI yet).

ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS booking_bot_enabled BOOLEAN DEFAULT false;
ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS escalation_phone TEXT;
ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS open_days INT[] DEFAULT '{0,1,2,3,4,5,6}'; -- 0=Sun..6=Sat
ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS open_time TIME DEFAULT '10:00';
ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS close_time TIME DEFAULT '20:00';
ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS slot_interval_minutes INT DEFAULT 30;

-- ── WHATSAPP CONVERSATION STATE (per phone number) ──
CREATE TABLE wa_conversations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  phone TEXT UNIQUE NOT NULL,
  history JSONB DEFAULT '[]',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── WHATSAPP MESSAGE LOG ──
CREATE TABLE wa_messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  phone TEXT NOT NULL,
  patient_id UUID REFERENCES patients(id),
  direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
  body TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE wa_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE wa_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "wa_conversations_admin_select" ON wa_conversations FOR SELECT TO authenticated USING (current_staff_role() = 'admin');
CREATE POLICY "wa_messages_admin_select" ON wa_messages FOR SELECT TO authenticated USING (current_staff_role() = 'admin');
