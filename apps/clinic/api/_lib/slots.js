// Server-side port of the slot-conflict logic in Appointments.jsx (staff
// leave check + same-day overlap test), so the booking bot can offer and
// validate real slots. Appointments.jsx keeps its own client-side copy for
// the staff-facing manual-booking UI — this is not meant to replace that.
function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && aEnd > bStart
}

async function getClinicHours(admin) {
  const { data } = await admin.from('clinic_settings').select('open_days, open_time, close_time, slot_interval_minutes').eq('id', 1).maybeSingle()
  return {
    openDays: data?.open_days ?? [0, 1, 2, 3, 4, 5, 6],
    openTime: data?.open_time ?? '10:00',
    closeTime: data?.close_time ?? '20:00',
    interval: data?.slot_interval_minutes ?? 30,
  }
}

// Returns an array of { time: 'HH:MM' } candidate start times still free for
// the given doctor (or unassigned) on `date`, given `durationMinutes`.
export async function getOpenSlots({ admin, date, doctorId, durationMinutes }) {
  const hours = await getClinicHours(admin)
  const dow = new Date(date + 'T00:00:00').getDay()
  if (!hours.openDays.includes(dow)) return []

  if (doctorId) {
    const { data: onLeave } = await admin.from('staff_leave').select('id').eq('staff_id', doctorId).eq('leave_date', date).maybeSingle()
    if (onLeave) return []
  }

  const dayStart = new Date(date + 'T00:00:00'), dayEnd = new Date(dayStart); dayEnd.setDate(dayEnd.getDate() + 1)
  let existing = []
  if (doctorId) {
    const { data } = await admin.from('appointments')
      .select('appointment_time, duration_minutes')
      .eq('doctor_id', doctorId)
      .gte('appointment_time', dayStart.toISOString()).lt('appointment_time', dayEnd.toISOString())
      .not('status', 'in', '("cancelled","no_show")')
    existing = data ?? []
  }

  const duration = durationMinutes || 30
  const [openH, openM] = hours.openTime.split(':').map(Number)
  const [closeH, closeM] = hours.closeTime.split(':').map(Number)
  const slots = []
  const cursor = new Date(date + 'T00:00:00'); cursor.setHours(openH, openM, 0, 0)
  const close = new Date(date + 'T00:00:00'); close.setHours(closeH, closeM, 0, 0)

  while (cursor.getTime() + duration * 60000 <= close.getTime()) {
    const slotStart = new Date(cursor)
    const slotEnd = new Date(slotStart.getTime() + duration * 60000)
    const clash = existing.find(a => {
      const aStart = new Date(a.appointment_time)
      const aEnd = new Date(aStart.getTime() + (a.duration_minutes || 30) * 60000)
      return overlaps(slotStart, slotEnd, aStart, aEnd)
    })
    if (!clash && slotStart.getTime() > Date.now()) {
      slots.push({ time: slotStart.toTimeString().slice(0, 5) })
    }
    cursor.setMinutes(cursor.getMinutes() + hours.interval)
  }
  return slots
}

// Single-slot recheck immediately before booking, to close the race between
// "the AI said this was free" and another booking landing first.
export async function isSlotFree({ admin, date, time, doctorId, durationMinutes }) {
  const duration = durationMinutes || 30
  const start = new Date(date + 'T' + time + ':00')
  const end = new Date(start.getTime() + duration * 60000)
  if (start.getTime() <= Date.now()) return false

  if (doctorId) {
    const { data: onLeave } = await admin.from('staff_leave').select('id').eq('staff_id', doctorId).eq('leave_date', date).maybeSingle()
    if (onLeave) return false

    const dayStart = new Date(date + 'T00:00:00'), dayEnd = new Date(dayStart); dayEnd.setDate(dayEnd.getDate() + 1)
    const { data: existing } = await admin.from('appointments')
      .select('appointment_time, duration_minutes')
      .eq('doctor_id', doctorId)
      .gte('appointment_time', dayStart.toISOString()).lt('appointment_time', dayEnd.toISOString())
      .not('status', 'in', '("cancelled","no_show")')
    const clash = (existing ?? []).find(a => {
      const aStart = new Date(a.appointment_time)
      const aEnd = new Date(aStart.getTime() + (a.duration_minutes || 30) * 60000)
      return overlaps(start, end, aStart, aEnd)
    })
    if (clash) return false
  }

  const hours = await getClinicHours(admin)
  const dow = start.getDay()
  if (!hours.openDays.includes(dow)) return false
  return true
}
