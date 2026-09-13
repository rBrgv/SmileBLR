-- 001: bookings intake (deployed)
CREATE TABLE bookings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  patient_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  reason TEXT,
  preferred_day TEXT,
  notes TEXT,
  status TEXT DEFAULT 'new' CHECK (status IN ('new','confirmed','completed','cancelled')),
  lead_source TEXT DEFAULT 'website' CHECK (lead_source IN ('website','whatsapp_direct','referral','walkin')),
  assigned_doctor TEXT DEFAULT 'Dr. Prithvi S. Balepur',
  appointment_time TIMESTAMPTZ,
  consent_given BOOLEAN DEFAULT FALSE,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE OR REPLACE FUNCTION update_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER bookings_updated_at BEFORE UPDATE ON bookings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public_insert_bookings" ON bookings FOR INSERT TO anon WITH CHECK (consent_given = true);
CREATE POLICY "staff_select_bookings" ON bookings FOR SELECT TO authenticated USING (true);
CREATE POLICY "staff_update_bookings" ON bookings FOR UPDATE TO authenticated USING (true);
ALTER PUBLICATION supabase_realtime ADD TABLE bookings;
