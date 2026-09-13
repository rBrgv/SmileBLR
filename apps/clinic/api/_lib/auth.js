// Shared "is this caller an admin?" check, same logic as staff-invite.js used inline.
import { createClient } from '@supabase/supabase-js'

export function serviceClient() {
  return createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
}

// Returns the admin service-role client on success, or sends a 401/403 response and returns null.
export async function requireAdmin(req, res) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY is not configured on the server.' })
    return null
  }
  const token = (req.headers.authorization || '').replace('Bearer ', '')
  if (!token) { res.status(401).json({ error: 'Missing auth token' }); return null }

  const admin = serviceClient()
  const { data: caller, error: authErr } = await admin.auth.getUser(token)
  if (authErr || !caller?.user) { res.status(401).json({ error: 'Invalid session' }); return null }

  const { data: callerStaff } = await admin.from('staff').select('role').eq('user_id', caller.user.id).eq('active', true).maybeSingle()
  if (callerStaff?.role !== 'admin') { res.status(403).json({ error: 'Admins only' }); return null }

  return admin
}
