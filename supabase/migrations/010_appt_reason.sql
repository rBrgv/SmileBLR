-- ============================================
-- CANCELLATION / NO-SHOW REASON
-- ============================================
-- Marking an appointment cancelled or no-show was a bare status flip with
-- no record of why — no way to spot patterns (repeat no-shows, a recurring
-- scheduling conflict, etc.).
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS status_reason TEXT;
