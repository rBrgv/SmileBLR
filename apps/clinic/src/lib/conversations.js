// wa_messages is one row per message; the inbox wants one line per person.
// Rows arrive newest first. A conversation needs attention when the last word
// was theirs, which is the case whether the bot has answered yet or is down.
export function groupConversations(messages) {
  const byPhone = new Map()
  for (const m of messages) {
    let c = byPhone.get(m.phone)
    if (!c) {
      c = { phone: m.phone, last: m, count: 0, fromThem: 0, patient: null, patientId: null }
      byPhone.set(m.phone, c)
    }
    c.count++
    if (m.direction === 'in') c.fromThem++
    // The patient may only have been matched on a later message, e.g. after
    // their number was added to a record.
    if (!c.patientId && m.patient_id) { c.patientId = m.patient_id; c.patient = m.patients?.full_name || null }
  }
  return [...byPhone.values()].map(c => ({ ...c, unanswered: c.last.direction === 'in' }))
}

// Show the end of the number, not all of it, in a list that may be left open
// on a front-desk screen.
export const maskPhone = phone => {
  const d = String(phone ?? '').replace(/\D/g, '')
  return d.length > 4 ? '•••• ' + d.slice(-4) : d
}
