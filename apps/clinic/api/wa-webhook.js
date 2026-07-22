// Vercel serverless function — receives inbound WhatsApp replies (Meta Cloud
// API webhook) so a patient replying "confirm" or "cancel" to a reminder
// updates their appointment without front-desk relaying it manually.
//
// IMPORTANT — cannot be verified from this environment: this needs to be
// registered as the webhook URL in Meta Business Manager (WhatsApp >
// Configuration), with WA_VERIFY_TOKEN below matching the "Verify token"
// entered there. Meta calls GET once to verify ownership, then POSTs every
// inbound message here.
//
// Requires, in this project's Vercel env (server-side only):
//   WA_VERIFY_TOKEN            — any random string, must match Meta's dashboard config
//   WA_ACCESS_TOKEN, WA_PHONE_NUMBER_ID — same as /api/send-reminders
//   SUPABASE_SERVICE_ROLE_KEY  — to read/update across all patients regardless of RLS
import { createClient } from '@supabase/supabase-js'

const CONFIRM_WORDS = ['confirm', 'yes', 'y', 'ok', 'okay', '1']
const CANCEL_WORDS = ['cancel', 'no', 'n', '2']

async function sendText(to, body) {
  const url = `https://graph.facebook.com/v18.0/${process.env.WA_PHONE_NUMBER_ID}/messages`
  await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.WA_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body } }),
  }).catch(() => {})
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = req.query
    if (mode === 'subscribe' && token === process.env.WA_VERIFY_TOKEN) return res.status(200).send(challenge)
    return res.status(403).send('Forbidden')
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })

  // Always ack quickly — Meta retries aggressively on non-200 responses.
  res.status(200).json({ received: true })

  try {
    const message = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]
    if (!message || message.type !== 'text') return
    const from = String(message.from).replace(/\D/g, '')
    const text = (message.text?.body || '').trim().toLowerCase()
    const isConfirm = CONFIRM_WORDS.includes(text)
    const isCancel = CANCEL_WORDS.includes(text)
    if (!isConfirm && !isCancel) return

    const admin = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
    const last10 = from.slice(-10)
    const { data: patients } = await admin.from('patients').select('id, full_name, phone').ilike('phone', `%${last10}`)
    const patient = (patients ?? [])[0]
    if (!patient) return

    const { data: appt } = await admin.from('appointments')
      .select('id, appointment_time').eq('patient_id', patient.id)
      .gte('appointment_time', new Date().toISOString())
      .not('status', 'in', '("cancelled","no_show","completed")')
      .order('appointment_time').limit(1).maybeSingle()
    if (!appt) return

    const status = isConfirm ? 'confirmed' : 'cancelled'
    await admin.from('appointments').update({ status }).eq('id', appt.id)
    await admin.from('activity_log').insert({
      action: `appointment.${status}_whatsapp`, entity_type: 'appointments', entity_id: appt.id,
      summary: `${patient.full_name} ${status} their appointment by replying on WhatsApp`,
    }).catch(() => {}) // activity_log may not exist yet pre-migration — best effort

    const when = new Date(appt.appointment_time).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
    await sendText(from, isConfirm
      ? `Thanks — your appointment on ${when} is confirmed. See you then!`
      : `Your appointment on ${when} has been cancelled. Reply anytime to rebook.`)
  } catch {
    // Best-effort — inbound webhook already acked above, nothing more to do.
  }
}
