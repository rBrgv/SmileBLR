// OpenAI tool-calling definitions + handlers for the WhatsApp booking bot.
// Every handler is scoped to the verified sender's own phone/patient —
// never a value the model could supply on the caller's behalf.
import { getOpenSlots, isSlotFree } from './slots.js'
import { sendText } from './wa.js'

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
export function buildTools(patient) {
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
  } else {
    tools.push({
      type: 'function',
      function: {
        name: 'create_lead',
        description: 'Record a new-patient enquiry for front desk follow-up (use when the sender is not an existing patient).',
        parameters: {
          type: 'object',
          properties: {
            full_name: { type: 'string' },
            preferred_time: { type: 'string', description: 'Free text, e.g. "tomorrow afternoon"' },
            reason: { type: 'string' },
          },
          required: ['full_name'],
        },
      },
    })
  }
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

  if (name === 'create_lead' && !patient) {
    await admin.from('bookings').insert({
      patient_name: args.full_name, phone, reason: args.reason || null,
      preferred_day: args.preferred_time || null, lead_source: 'whatsapp_direct', status: 'new',
    })
    return { ok: true }
  }

  if (name === 'escalate') {
    const { data: settings } = await admin.from('clinic_settings').select('escalation_phone').eq('id', 1).maybeSingle()
    if (settings?.escalation_phone) {
      await sendText(settings.escalation_phone, `[ESCALATE] ${patient?.full_name || phone}: ${args.reason}`)
    }
    return { ok: true }
  }

  return { ok: false, error: 'Tool not available for this conversation.' }
}
