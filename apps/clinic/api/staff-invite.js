// Vercel serverless function — creates a real Supabase Auth login for a staff
// member and links it to their `staff` directory row, so a dentist can invite
// their own team without touching the Supabase dashboard.
//
// POST /api/staff-invite  { email, full_name, role }
// Header: Authorization: Bearer <the caller's Supabase access token>
// The caller's own staff.role must be 'admin' — enforced server-side here,
// not just hidden in the UI, since the UI can always be bypassed.
//
// Requires SUPABASE_SERVICE_ROLE_KEY set in this project's server-side env
// (Vercel → Settings → Environment Variables). NEVER prefix it with VITE_ —
// that would ship it to every visitor's browser.
import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })

  const token = (req.headers.authorization || '').replace('Bearer ', '')
  if (!token) return res.status(401).json({ error: 'Missing auth token' })

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY is not configured on the server.' })
  }

  const admin = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

  const { data: caller, error: authErr } = await admin.auth.getUser(token)
  if (authErr || !caller?.user) return res.status(401).json({ error: 'Invalid session' })

  const { data: callerStaff } = await admin.from('staff').select('role').eq('user_id', caller.user.id).eq('active', true).maybeSingle()
  if (callerStaff?.role !== 'admin') return res.status(403).json({ error: 'Only admins can invite staff.' })

  const { email, full_name, role } = req.body || {}
  if (!email || !full_name) return res.status(400).json({ error: 'email and full_name are required' })

  const { data: invited, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email)
  if (inviteErr) return res.status(502).json({ error: inviteErr.message })

  const { data: existing } = await admin.from('staff').select('id').eq('email', email).maybeSingle()
  const rec = { email, full_name, role: role || 'assistant', user_id: invited.user.id, active: true }
  const { error: staffErr } = existing
    ? await admin.from('staff').update(rec).eq('id', existing.id)
    : await admin.from('staff').insert(rec)
  if (staffErr) return res.status(502).json({ error: staffErr.message })

  return res.status(200).json({ ok: true })
}
