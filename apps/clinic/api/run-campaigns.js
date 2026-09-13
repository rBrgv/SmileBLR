// Vercel Cron endpoint (daily — see vercel.json; Vercel's Hobby plan only
// allows daily-or-less-frequent crons, so this can't run more often than
// once a day regardless of what an individual campaign's schedule_cron says).
// Automated campaign sending is a Pro-plan feature: on the Free plan this is
// a deliberate no-op, so clinics only ever get messaged via the manual
// "Send now" button.
//
// Requires, in this project's Vercel env (server-side only):
//   CRON_SECRET, SUPABASE_SERVICE_ROLE_KEY — same as /api/send-reminders
import { serviceClient } from './_lib/auth.js'
import { runCampaign } from './send-campaign.js'

// schedule_cron is treated as "run at most once per this many hours" rather
// than parsed as full cron syntax — but since this cron itself only fires
// once a day, nothing shorter than ~24h is actually achievable today.
function dueToRun(campaign) {
  if (!campaign.schedule_cron) return false
  const hours = parseInt(campaign.schedule_cron, 10)
  if (!hours || hours < 1) return false
  if (!campaign.last_run_at) return true
  const elapsedHours = (Date.now() - new Date(campaign.last_run_at).getTime()) / 3_600_000
  return elapsedHours >= hours
}

export default async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`)
    return res.status(401).json({ error: 'Unauthorized' })

  const admin = serviceClient()

  const { data: settings } = await admin.from('clinic_settings').select('plan').eq('id', 1).maybeSingle()
  if (settings?.plan !== 'pro') {
    return res.status(200).json({ skipped: true, reason: 'Automated campaigns require the Pro plan' })
  }

  const { data: campaigns } = await admin.from('campaigns').select('*').eq('active', true).not('schedule_cron', 'is', null)
  const due = (campaigns ?? []).filter(dueToRun)

  const results = {}
  for (const campaign of due) results[campaign.name] = await runCampaign(admin, campaign)

  return res.status(200).json({ ran: due.length, results })
}
