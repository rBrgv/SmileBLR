// POST /api/campaign-audience  { campaign_id } OR { draft: { audience, audience_tag } }
// Header: Authorization: Bearer <caller's Supabase access token>, admin only.
// Resolves a campaign's audience and returns a count + preview list, so an
// admin can sanity-check who a campaign will message before sending it. The
// `draft` form lets the UI preview a not-yet-saved campaign while it's being built.
import { requireAdmin } from './_lib/auth.js'
import { resolveAudience } from './_lib/audience.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })
  const admin = await requireAdmin(req, res)
  if (!admin) return

  const { campaign_id, draft } = req.body || {}
  let campaign
  if (draft) {
    campaign = { audience: draft.audience, audience_tag: draft.audience_tag || null }
  } else {
    if (!campaign_id) return res.status(400).json({ error: 'campaign_id is required' })
    const { data, error } = await admin.from('campaigns').select('*').eq('id', campaign_id).maybeSingle()
    if (error || !data) return res.status(404).json({ error: 'Campaign not found' })
    campaign = data
  }

  const patients = await resolveAudience(admin, campaign)
  return res.status(200).json({
    count: patients.length,
    preview: patients.slice(0, 20).map(p => ({ id: p.id, full_name: p.full_name, phone: p.phone })),
  })
}
