// OpenAI tool-calling definitions + handlers for the WhatsApp booking bot.
// Every handler is scoped to the verified sender's own phone/patient —
// never a value the model could supply on the caller's behalf.
import { todayLocal } from './clinic-time.js'
import { getOpenSlots, isSlotFree } from './slots.js'
import { sendText } from './wa.js'

// The model is told to escalate anything medical and does not always do so — a
// message about bleeding gums was filed as an ordinary enquiry. So the words
// that mean "a person should look at this" are matched here, outside the
// model, and raise an escalation regardless. It errs towards notifying staff:
// a false alarm costs a glance, a missed one costs a patient.
const URGENT = /\b(pain|painful|ache|aching|toothache|bleed(ing|s)?|blood|swell(ing|s)?|swollen|fever|pus|abscess|infect(ed|ion)|broken|broke|chipped|fracture[d]?|knocked|trauma|accident|injur(y|ed)|emergency|urgent|numb(ness)?|allerg(y|ic)|reaction|can'?t (open|swallow|breathe|eat|sleep))\b/i
export const isUrgent = text => URGENT.test(String(text ?? ''))

const last10 = phone => String(phone ?? '').replace(/\D/g, '').slice(-10)

// Every live patient whose number ends with the sender's. More than one is
// common — a family on one phone — and the first of them is not necessarily
// the one writing, so callers must not assume a single match.
export async function matchPatients(admin, phone) {
  const { data, error } = await admin.from('patients').select('id, full_name, phone')
    .is('merged_into', null).is('deleted_at', null).ilike('phone', `%${last10(phone)}`).limit(5)
  if (error) throw error
  return data ?? []
}

// A stranger cannot book, because a booking needs a patient. Rather than turn
// them away, the assistant may register them — but only as the number they are
// writing from, never one they type, and only a handful a day so the patient
// list cannot be filled with junk by anyone who knows the clinic's number.
export const WHATSAPP_SOURCE = 'WhatsApp assistant'
export const DAILY_REGISTRATION_CAP = 20

async function createPatient(admin, phone, args) {
  const name = String(args.full_name ?? '').trim().replace(/\s+/g, ' ')
  if (name.length < 2 || name.length > 80 || !/\p{L}/u.test(name))
    return { ok: false, error: 'Ask the person for their full name before registering them.' }

  // Someone may have been registered since this conversation began.
  const existing = await matchPatients(admin, phone)
  if (existing.length === 1) return { ok: true, patient: existing[0], already_registered: true }
  if (existing.length > 1) return { ok: false, error: 'This number belongs to several patients. Take a front-desk follow-up instead.' }

  const startOfDay = new Date(todayLocal() + 'T00:00:00').toISOString()
  const { count } = await admin.from('patients').select('id', { count: 'exact', head: true })
    .eq('referral_source', WHATSAPP_SOURCE).gte('created_at', startOfDay)
  if ((count ?? 0) >= DAILY_REGISTRATION_CAP)
    return { ok: false, error: 'Online registration is full for today. Take a front-desk follow-up instead.' }

  const age = Number.parseInt(args.age, 10)
  const row = { full_name: name, phone: last10(phone), referral_source: WHATSAPP_SOURCE }
  if (Number.isInteger(age) && age >= 0 && age <= 110) Object.assign(row, { approx_age: age, approx_age_recorded_on: todayLocal() })

  const { data, error } = await admin.from('patients').insert(row).select('id, full_name, phone').single()
  if (error) return { ok: false, error: 'Could not register right now. Take a front-desk follow-up instead.' }
  await admin.from('activity_log').insert({
    action: 'patient.registered_whatsapp', entity_type: 'patients', entity_id: data.id,
    summary: 'Patient registered by the WhatsApp assistant — confirm details at their first visit',
  })
  return { ok: true, patient: data }
}

async function findDoctor(admin, name) {
  if (!name) return null
  const { data } = await admin.from('staff').select('id, full_name').eq('role', 'doctor').eq('active', true).ilike('full_name', `%${name}%`).limit(1).maybeSingle()
  return data
}

async function findTreatment(admin, name) {
  if (!name) return null
  const { data } = await admin.from('treatments').select('id, name, typical_duration_minutes').ilike('name', `%${name}%`).limit(1).maybeSingle()
  return data
}

async function nextAppointment(admin, patientId) {
  return admin.from('appointments').select('id, appointment_time, status')
    .eq('patient_id', patientId)
    .gte('appointment_time', new Date().toISOString())
    .not('status', 'in', '("cancelled","no_show","completed")')
    .order('appointment_time').limit(1).maybeSingle()
}

// `patient` is { id, full_name, phone } or null for an unrecognized sender.
// `shared` is true when several patients use the sender's number.
export function buildTools(patient, { shared = false } = {}) {
  const tools = [
    {
      type: 'function',
      function: {
        name: 'list_slots',
        description: 'List open appointment slots on a given date, optionally for a specific doctor or treatment.',
        parameters: {
          type: 'object',
          properties: {
            date: { type: 'string', description: 'YYYY-MM-DD' },
            doctor_name: { type: 'string' },
            treatment_name: { type: 'string' },
          },
          required: ['date'],
        },
      },
    },
  ]
  if (patient) {
    tools.push(
      {
        type: 'function',
        function: {
          name: 'book_appointment',
          description: "Book the patient's appointment at a specific date and time.",
          parameters: {
            type: 'object',
            properties: {
              date: { type: 'string', description: 'YYYY-MM-DD' },
              time: { type: 'string', description: 'HH:MM, 24-hour' },
              doctor_name: { type: 'string' },
              treatment_name: { type: 'string' },
            },
            required: ['date', 'time'],
          },
        },
      },
      { type: 'function', function: { name: 'cancel_appointment', description: "Cancel the patient's next upcoming appointment.", parameters: { type: 'object', properties: {} } } },
      {
        type: 'function',
        function: {
          name: 'reschedule_appointment',
          description: "Move the patient's next upcoming appointment to a new date/time.",
          parameters: {
            type: 'object',
            properties: { new_date: { type: 'string' }, new_time: { type: 'string' } },
            required: ['new_date', 'new_time'],
          },
        },
      },
      { type: 'function', function: { name: 'check_my_bookings', description: "List the patient's upcoming appointments.", parameters: { type: 'object', properties: {} } } },
    )
  } else if (!shared) {
    tools.push({
      type: 'function',
      function: {
        name: 'create_patient',
        description: 'Register the person writing as a new patient so they can be booked. Call this once you have their full name. The phone number is taken from WhatsApp automatically.',
        parameters: {
          type: 'object',
          properties: {
            full_name: { type: 'string', description: 'Full name of the person the appointment is for' },
            age: { type: 'integer', description: 'Age in years, only if they volunteered it' },
          },
          required: ['full_name'],
        },
      },
    })
  }
  // A front-desk follow-up is always available: for a question the assistant
  // cannot answer, for someone booking on another person's behalf, and for a
  // number shared by several patients where the assistant must not guess who.
  tools.push({
    type: 'function',
    function: {
      name: 'create_lead',
      description: 'Ask the front desk to call back: for a new-patient enquiry that is not ready to book, a booking for someone other than the sender, or when the sender cannot be identified.',
      parameters: {
        type: 'object',
        properties: {
          full_name: { type: 'string', description: 'Name of the person the follow-up is about' },
          preferred_time: { type: 'string', description: 'Free text, e.g. "tomorrow afternoon"' },
          reason: { type: 'string' },
        },
        required: ['full_name'],
      },
    },
  })
  tools.push({
    type: 'function',
    function: {
      name: 'escalate',
      description: 'Forward this conversation to clinic staff — use for medical questions, complaints, injuries, or pricing negotiation. Never guess on these.',
      parameters: { type: 'object', properties: { reason: { type: 'string' } }, required: ['reason'] },
    },
  })
  return tools
}

export async function runTool(admin, patient, phone, name, args) {
  if (name === 'list_slots') {
    const doctor = await findDoctor(admin, args.doctor_name)
    const treatment = await findTreatment(admin, args.treatment_name)
    const slots = await getOpenSlots({
      admin, date: args.date, doctorId: doctor?.id,
      durationMinutes: treatment?.typical_duration_minutes,
    })
    return { slots: slots.map(s => s.time), doctor: doctor?.full_name || null, treatment: treatment?.name || null }
  }

  if (name === 'book_appointment' && patient) {
    const doctor = await findDoctor(admin, args.doctor_name)
    const treatment = await findTreatment(admin, args.treatment_name)
    const duration = treatment?.typical_duration_minutes || 30
    const free = await isSlotFree({ admin, date: args.date, time: args.time, doctorId: doctor?.id, durationMinutes: duration })
    if (!free) return { ok: false, error: 'That slot is no longer available. Please suggest another.' }
    const { error } = await admin.from('appointments').insert({
      patient_id: patient.id, doctor_id: doctor?.id || null, treatment_id: treatment?.id || null,
      appointment_time: new Date(args.date + 'T' + args.time + ':00').toISOString(),
      duration_minutes: duration, status: 'scheduled',
    })
    if (error) return { ok: false, error: error.message }
    return { ok: true, date: args.date, time: args.time, doctor: doctor?.full_name || null }
  }

  if (name === 'cancel_appointment' && patient) {
    const { data: appt } = await nextAppointment(admin, patient.id)
    if (!appt) return { ok: false, error: 'No upcoming appointment found.' }
    await admin.from('appointments').update({ status: 'cancelled' }).eq('id', appt.id)
    return { ok: true }
  }

  if (name === 'reschedule_appointment' && patient) {
    const { data: appt } = await nextAppointment(admin, patient.id)
    if (!appt) return { ok: false, error: 'No upcoming appointment found to reschedule.' }
    const free = await isSlotFree({ admin, date: args.new_date, time: args.new_time })
    if (!free) return { ok: false, error: 'That slot is not available. Please suggest another.' }
    await admin.from('appointments').update({
      appointment_time: new Date(args.new_date + 'T' + args.new_time + ':00').toISOString(), status: 'scheduled',
    }).eq('id', appt.id)
    return { ok: true, date: args.new_date, time: args.new_time }
  }

  if (name === 'check_my_bookings' && patient) {
    const { data } = await admin.from('appointments')
      .select('appointment_time, status').eq('patient_id', patient.id)
      .gte('appointment_time', new Date().toISOString())
      .not('status', 'in', '("cancelled","no_show")')
      .order('appointment_time')
    return { appointments: data ?? [] }
  }

  if (name === 'create_patient' && !patient) return createPatient(admin, phone, args)

  if (name === 'create_lead') {
    await admin.from('bookings').insert({
      patient_name: args.full_name, phone, reason: args.reason || null,
      preferred_day: args.preferred_time || null, lead_source: 'whatsapp_direct', status: 'new',
    })
    return { ok: true }
  }

  if (name === 'escalate') {
    // The record comes first. A WhatsApp alert to staff only arrives if that
    // staff number has messaged the clinic in the last 24 hours, and it is
    // dropped silently otherwise, so on its own it cannot be what the patient
    // is told was done. A row on the Bookings screen is always seen.
    const { error: leadError } = await admin.from('bookings').insert({
      patient_name: patient?.full_name || 'WhatsApp enquiry', phone,
      reason: '[NEEDS STAFF] ' + String(args.reason || 'Escalated from WhatsApp').slice(0, 500),
      lead_source: 'whatsapp_direct', status: 'new',
    })
    const { data: settings } = await admin.from('clinic_settings').select('escalation_phone').eq('id', 1).maybeSingle()
    let alerted = false
    if (settings?.escalation_phone) {
      const sent = await sendText(settings.escalation_phone, `[ESCALATE] ${patient?.full_name || phone}: ${args.reason}`)
      alerted = Boolean(sent?.ok)
    }
    // Only claim what actually happened, so the assistant cannot reassure a
    // patient that staff were told when nothing was recorded or sent.
    return leadError && !alerted
      ? { ok: false, error: 'Staff could not be notified. Ask the patient to call the clinic.' }
      : { ok: true, recorded_for_front_desk: !leadError, staff_alerted_on_whatsapp: alerted }
  }

  return { ok: false, error: 'Tool not available for this conversation.' }
}
