// POST /api/send-campaign  { campaign_id }
// Header: Authorization: Bearer <caller's Supabase access token>, admin only.
// Sends a campaign right now, to every matching patient not already messaged
// today for this campaign. Available regardless of clinic_settings.plan —
// this is the Free-tier "Send now" button's target; Pro clinics can also use
// it for one-off sends outside their scheduled runs.
import { requireAdmin } from './_lib/auth.js'
import { resolveAudience } from './_lib/audience.js'
import { sendWhatsApp, sendSMS } from './_lib/wa.js'

export async function runCampaign(admin, campaign) {
  const patients = await resolveAudience(admin, campaign)
  const today = new Date().toISOString().slice(0, 10)

  const { data: alreadySent } = await admin.from('campaign_sends')
    .select('patient_id, sent_at').eq('campaign_id', campaign.id).gte('sent_at', `${today}T00:00:00Z`)
  const sentToday = new Set((alreadySent ?? []).map(r => r.patient_id))

  const result = { sent: 0, smsFallbacks: 0, skipped: 0, failed: 0 }
  for (const patient of patients) {
    if (sentToday.has(patient.id)) { result.skipped++; continue }

    const template = campaign.wa_template_name
    const { ok } = template
      ? await sendWhatsApp(patient.phone, template, [patient.full_name])
      : { ok: false }

    if (ok) {
      await admin.from('campaign_sends').insert({ campaign_id: campaign.id, patient_id: patient.id, status: 'sent' })
      result.sent++
      continue
    }

    const sms = await sendSMS(patient.phone, campaign.message_template.replace('{{name}}', patient.full_name))
    if (sms.ok) {
      await admin.from('campaign_sends').insert({ campaign_id: campaign.id, patient_id: patient.id, status: 'sent' })
      result.smsFallbacks++
    } else {
      await admin.from('campaign_sends').insert({
        campaign_id: campaign.id, patient_id: patient.id, status: 'failed',
        error: sms.skipped ? 'No WhatsApp template configured and no SMS fallback available' : 'WhatsApp and SMS both failed',
      })
      result.failed++
    }
  }

  await admin.from('campaigns').update({ last_run_at: new Date().toISOString() }).eq('id', campaign.id)
  return result
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })
  const admin = await requireAdmin(req, res)
  if (!admin) return

  const { campaign_id } = req.body || {}
  if (!campaign_id) return res.status(400).json({ error: 'campaign_id is required' })

  const { data: campaign, error } = await admin.from('campaigns').select('*').eq('id', campaign_id).maybeSingle()
  if (error || !campaign) return res.status(404).json({ error: 'Campaign not found' })

  const result = await runCampaign(admin, campaign)
  return res.status(200).json(result)
}
