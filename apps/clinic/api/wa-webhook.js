// Vercel serverless function — receives inbound WhatsApp replies (Meta Cloud
// API webhook). Handles two things: a patient replying "confirm"/"cancel" to
// a reminder (deterministic, no AI), and — when booking_bot_enabled is on —
// everything else via an AI tool-calling receptionist that can check slots
// and book/cancel/reschedule appointments.
//
// IMPORTANT — cannot be verified from this environment: this needs to be
// registered as the webhook URL in Meta Business Manager (WhatsApp >
// Configuration), with WA_VERIFY_TOKEN below matching the "Verify token"
// entered there. Meta calls GET once to verify ownership, then POSTs every
// inbound message here.
//
// Requires, in this project's Vercel env (server-side only):
//   WA_VERIFY_TOKEN            — any random string, must match Meta's dashboard config
//   WA_APP_SECRET              — Meta app secret used to verify POST signatures
//   WA_ACCESS_TOKEN, WA_PHONE_NUMBER_ID — same as /api/send-reminders
//   SUPABASE_SERVICE_ROLE_KEY  — to read/update across all patients regardless of RLS
//   OPENAI_API_KEY             — only needed if booking_bot_enabled is turned on
import { todayLocal } from './_lib/clinic-time.js'
import { createClient } from '@supabase/supabase-js'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { sendText } from './_lib/wa.js'
import { chat } from './_lib/ai.js'
import { buildTools, runTool, isUrgent, matchPatients } from './_lib/booking-tools.js'

const CONFIRM_WORDS = ['confirm', 'yes', 'y', 'ok', 'okay', '1']
const CANCEL_WORDS = ['cancel', 'no', 'n', '2']
// A stranger who is registered and then booked needs register, list slots, book
// and a closing reply — four model calls on their own — so there is headroom.
const MAX_TOOL_ROUNDS = 6

async function buildSystemPrompt(admin, patient, shared = false) {
  const { data: settings } = await admin.from('clinic_settings')
    .select('open_days, open_time, close_time').eq('id', 1).maybeSingle()
  const { data: doctors } = await admin.from('staff').select('full_name, specialization').eq('role', 'doctor').eq('active', true)
  const { data: treatments } = await admin.from('treatments').select('name')
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const openDays = (settings?.open_days ?? [0, 1, 2, 3, 4, 5, 6]).map(d => dayNames[d]).join(', ')

  return [
    'You are the WhatsApp receptionist for Smile Bengaluru, a dental clinic.',
    `Today's date is ${todayLocal()}.`,
    `Clinic hours: ${openDays}, ${settings?.open_time ?? '10:00'}–${settings?.close_time ?? '20:00'}.`,
    `Doctors: ${(doctors ?? []).map(d => `${d.full_name}${d.specialization ? ' (' + d.specialization + ')' : ''}`).join('; ') || 'none listed'}.`,
    `Treatments offered: ${(treatments ?? []).map(t => t.name).join(', ') || 'none listed'}.`,
    patient
      ? `You are speaking with an existing patient: ${patient.full_name}. If they say a booking is for someone else (a child, parent or spouse), do not book it on this patient's record: use create_lead with that person's name.`
      : shared
        ? 'This phone number is shared by several patients, so you cannot tell who is writing. Do not book, cancel or look up appointments. Ask who it is for and use create_lead so the front desk can call back.'
        : 'This sender is not registered yet. To book them: ask whether the appointment is for themselves, get the full name of the person being booked (and their age only if they offer it), call create_patient, then continue with list_slots and book_appointment. Never invent a name. If they only have a question, answer it; use create_lead only if they want the front desk to call back.',
    'Use the available tools for anything involving real data (slots, bookings, patient records) — never invent times, doctors, or confirmations.',
    'For anything medical (pain, symptoms, treatment advice), a complaint, or price negotiation, use the escalate tool rather than answering yourself.',
    'Keep replies short and friendly, suitable for WhatsApp.',
  ].join(' ')
}

async function runBookingBot(admin, phone, text) {
  const matches = await matchPatients(admin, phone)
  const shared = matches.length > 1
  // One match is the sender. Several is a family on one phone, and guessing
  // which of them is writing would book or cancel someone else's visit.
  let patient = matches.length === 1 ? matches[0] : null
  await admin.from('wa_messages').insert({ phone, patient_id: patient?.id || null, direction: 'in', body: text })

  const { data: convo } = await admin.from('wa_conversations').select('*').eq('phone', phone).maybeSingle()
  const history = convo?.history ?? []
  let systemPrompt = await buildSystemPrompt(admin, patient, shared)
  let tools = buildTools(patient, { shared })
  let escalated = false // one alert per message, whoever raises it

  // A symptom reaches staff whatever the model decides. One escalation per
  // half hour per number, so a patient describing it over five messages does
  // not page the front desk five times.
  if (isUrgent(text)) {
    const since = new Date(Date.now() - 30 * 60 * 1000).toISOString()
    const { data: recent } = await admin.from('bookings').select('id').eq('phone', phone)
      .like('reason', '[NEEDS STAFF]%').gte('created_at', since).limit(1)
    if (!recent?.length) await runTool(admin, patient, phone, 'escalate', { reason: `Message: "${text.slice(0, 300)}"` })
    escalated = true
    systemPrompt += ' The front desk has already been alerted about this message. Do not give medical advice or diagnose; tell the patient staff will contact them shortly, and say to call the clinic or go to an emergency department if it is severe.'
  }

  let messages = [{ role: 'system', content: systemPrompt }, ...history, { role: 'user', content: text }]
  let reply = null

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const message = await chat(messages, tools)
    messages.push(message)
    if (!message.tool_calls?.length) { reply = message.content; break }
    for (const call of message.tool_calls) {
      let args = {}
      try { args = JSON.parse(call.function.arguments || '{}') } catch { /* malformed args, treat as empty */ }
      let result
      if (call.function.name === 'escalate' && escalated) {
        result = { ok: true, already_raised: true } // the desk already has this message
      } else {
        result = await runTool(admin, patient, phone, call.function.name, args)
        if (call.function.name === 'escalate') escalated = true
      }
      // Registered mid-conversation: from here they are a patient, so booking
      // tools become available on the next round.
      if (call.function.name === 'create_patient' && result.ok && result.patient) {
        patient = result.patient
        tools = buildTools(patient)
      }
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) })
    }
  }
  if (!reply) reply = "Sorry, I couldn't finish that — please call the clinic directly."

  // Persist only the conversational turns (skip the system prompt, which is rebuilt fresh next time).
  await admin.from('wa_conversations').upsert({
    phone, history: messages.slice(1), updated_at: new Date().toISOString(),
  }, { onConflict: 'phone' })

  await admin.from('wa_messages').insert({ phone, patient_id: patient?.id || null, direction: 'out', body: reply })
  await sendText(phone, reply)
}

// Typed replies arrive as `text`; taps on a template's quick-reply buttons as
// `button`; taps on interactive reply buttons as `interactive`.
function replyText(message) {
  if (message.type === 'text') return message.text?.body
  if (message.type === 'button') return message.button?.text
  if (message.type === 'interactive') return message.interactive?.button_reply?.title
  return null
}

async function readRawBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  return Buffer.concat(chunks)
}

function hasValidSignature(rawBody, signature) {
  const secret = process.env.WA_APP_SECRET
  if (!secret || !signature?.startsWith('sha256=')) return false
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex')
  const supplied = signature.slice(7)
  if (!/^[a-f0-9]{64}$/i.test(supplied)) return false
  return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(supplied, 'hex'))
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = req.query
    if (mode === 'subscribe' && token === process.env.WA_VERIFY_TOKEN) return res.status(200).send(challenge)
    return res.status(403).send('Forbidden')
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })

  try {
    const rawBody = await readRawBody(req)
    if (!hasValidSignature(rawBody, req.headers['x-hub-signature-256']))
      return res.status(401).json({ error: 'Invalid signature' })

    const body = JSON.parse(rawBody.toString('utf8'))
    // One Meta app can carry several numbers, and this app also serves another
    // business, so a payload here is not necessarily for the clinic. Act only
    // on messages sent to the clinic's own number, and acknowledge the rest so
    // Meta does not retry them.
    const value = body?.entry?.[0]?.changes?.[0]?.value
    const toNumberId = value?.metadata?.phone_number_id
    if (toNumberId && process.env.WA_PHONE_NUMBER_ID && toNumberId !== process.env.WA_PHONE_NUMBER_ID)
      return res.status(200).json({ received: true, ignored: 'another number on this app' })

    const message = value?.messages?.[0]
    const rawText = (message && replyText(message) || '').trim()
    if (!rawText) return res.status(200).json({ received: true })
    const from = String(message.from).replace(/\D/g, '')
    const text = rawText.toLowerCase()
    const isConfirm = CONFIRM_WORDS.includes(text)
    const isCancel = CANCEL_WORDS.includes(text)

    const admin = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

    if (!isConfirm && !isCancel) {
      const { data: settings } = await admin.from('clinic_settings').select('booking_bot_enabled').eq('id', 1).maybeSingle()
      if (settings?.booking_bot_enabled && process.env.OPENAI_API_KEY && rawText) {
        await runBookingBot(admin, from, rawText)
      }
      return res.status(200).json({ received: true })
    }

    // "confirm" or "cancel" answers a reminder. With several patients on one
    // number it means whichever of them has the next visit, not the first
    // one the database happens to return.
    const patients = await matchPatients(admin, from)
    if (!patients.length) return res.status(200).json({ received: true })

    const { data: appt, error: appointmentError } = await admin.from('appointments')
      .select('id, patient_id, appointment_time').in('patient_id', patients.map(x => x.id))
      .gte('appointment_time', new Date().toISOString())
      .not('status', 'in', '("cancelled","no_show","completed")')
      .order('appointment_time').limit(1).maybeSingle()
    if (appointmentError) throw appointmentError
    if (!appt) return res.status(200).json({ received: true })
    const patient = patients.find(x => x.id === appt.patient_id)

    const status = isConfirm ? 'confirmed' : 'cancelled'
    const { error: updateError } = await admin.from('appointments').update({ status }).eq('id', appt.id)
    if (updateError) throw updateError
    // Best effort: Supabase returns (not throws) insert errors, so a logging
    // failure never blocks the patient's reply below.
    await admin.from('activity_log').insert({
      action: `appointment.${status}_whatsapp`, entity_type: 'appointments', entity_id: appt.id,
      summary: `${patient.full_name} ${status} their appointment by replying on WhatsApp`,
    })

    const when = new Date(appt.appointment_time).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
    await sendText(from, isConfirm
      ? `Thanks — your appointment on ${when} is confirmed. See you then!`
      : `Your appointment on ${when} has been cancelled. Reply anytime to rebook.`)
    return res.status(200).json({ received: true })
  } catch (error) {
    console.error('WhatsApp webhook failed', error)
    return res.status(500).json({ error: 'Webhook processing failed' })
  }
}

// Signature verification requires the exact bytes sent by Meta.
export const config = { api: { bodyParser: false } }
