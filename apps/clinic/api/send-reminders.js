// Vercel Cron endpoint (see vercel.json) — runs once daily, sends WhatsApp
// reminders for tomorrow's appointments and overdue recall reminders, and
// falls back to SMS when a number isn't reachable on WhatsApp.
//
// Requires, in this project's Vercel env (server-side only, never VITE_-prefixed):
//   CRON_SECRET                — Vercel sends this as a Bearer token on cron requests
//   WA_ACCESS_TOKEN, WA_PHONE_NUMBER_ID — already anticipated in .env.example
//   SUPABASE_SERVICE_ROLE_KEY  — to read across all patients regardless of RLS
//   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER — SMS fallback (optional)
//
// IMPORTANT — cannot be verified from this environment: WhatsApp's Business
// API only allows business-initiated messages through pre-approved message
// templates, not free-form text. This assumes templates named
// 'appointment_reminder' and 'recall_reminder' exist and are approved in
// Meta Business Manager, each taking the patient's name (and, for
// appointments, the time) as body variables. The `components` payload below
// has to match whatever those approved templates actually look like, or
// Meta will reject the send — adjust it once the real templates exist.
//
// The SMS fallback is written against Twilio's SMS API specifically as a
// concrete, well-documented default — swap `sendSMS` for whatever gateway
// this clinic actually contracts with (MSG91, Gupshup, etc. are common in
// India) if Twilio isn't it. Untested against a live Twilio account; the
// request shape is right, but there's no way to confirm delivery from here.
import { createClient } from '@supabase/supabase-js'

async function sendWhatsApp(to, template, variables) {
  const url = `https://graph.facebook.com/v18.0/${process.env.WA_PHONE_NUMBER_ID}/messages`
  const r = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.WA_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: String(to).replace(/\D/g, ''),
      type: 'template',
      template: {
        name: template, language: { code: 'en' },
        components: [{ type: 'body', parameters: variables.map(v => ({ type: 'text', text: String(v) })) }],
      },
    }),
  })
  return { ok: r.ok, data: await r.json().catch(() => ({})) }
}

async function sendSMS(to, body) {
  if (!process.env.TWILIO_ACCOUNT_SID) return { ok: false, skipped: true }
  const url = `https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Messages.json`
  const params = new URLSearchParams({
    To: '+91' + String(to).replace(/\D/g, '').slice(-10),
    From: process.env.TWILIO_FROM_NUMBER,
    Body: body,
  })
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params,
  })
  return { ok: r.ok, data: await r.json().catch(() => ({})) }
}

export default async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`)
    return res.status(401).json({ error: 'Unauthorized' })

  const admin = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  const results = { appointmentReminders: 0, recallReminders: 0, smsFallbacks: 0, errors: [] }

  // 1) Tomorrow's appointments
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1)
  const from = new Date(tomorrow); from.setHours(0, 0, 0, 0)
  const to = new Date(from); to.setDate(to.getDate() + 1)
  const { data: appts } = await admin.from('appointments')
    .select('id, appointment_time, patients(full_name, phone)')
    .gte('appointment_time', from.toISOString()).lt('appointment_time', to.toISOString())
    .not('status', 'in', '("cancelled","no_show")')
  for (const a of appts ?? []) {
    if (!a.patients?.phone) continue
    const time = new Date(a.appointment_time).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })
    const { ok, data } = await sendWhatsApp(a.patients.phone, 'appointment_reminder', [a.patients.full_name, time])
    if (ok) { results.appointmentReminders++; continue }
    const sms = await sendSMS(a.patients.phone, `Smile Bengaluru: reminder for your appointment tomorrow at ${time}.`)
    if (sms.ok) results.smsFallbacks++
    else if (!sms.skipped) results.errors.push({ type: 'appointment', id: a.id, error: data, smsError: sms.data })
  }

  // 2) Overdue recall reminders not yet sent
  const today = new Date().toISOString().slice(0, 10)
  const { data: recalls } = await admin.from('recall_reminders')
    .select('id, patients(full_name, phone)')
    .lte('recall_due_date', today).eq('reminder_sent', false)
  for (const r of recalls ?? []) {
    if (!r.patients?.phone) continue
    const { ok, data } = await sendWhatsApp(r.patients.phone, 'recall_reminder', [r.patients.full_name])
    if (ok) {
      await admin.from('recall_reminders').update({ reminder_sent: true, reminder_sent_date: new Date().toISOString() }).eq('id', r.id)
      results.recallReminders++
      continue
    }
    const sms = await sendSMS(r.patients.phone, `Smile Bengaluru: it's been 6 months since your last visit — time for a check-up. Call us to book.`)
    if (sms.ok) {
      await admin.from('recall_reminders').update({ reminder_sent: true, reminder_sent_date: new Date().toISOString() }).eq('id', r.id)
      results.smsFallbacks++
    } else if (!sms.skipped) results.errors.push({ type: 'recall', id: r.id, error: data, smsError: sms.data })
  }

  return res.status(200).json(results)
}
