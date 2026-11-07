import test from 'node:test'
import assert from 'node:assert/strict'
import { groupConversations, maskPhone } from '../src/lib/conversations.js'

test('messages become one line per person, newest first, flagged when unanswered', () => {
  // Newest first, as the query returns them.
  const rows = [
    { id: 4, phone: '919000000001', direction: 'in', body: 'Can I come today', created_at: '2026-11-07T06:00', patient_id: null },
    { id: 3, phone: '919000000002', direction: 'out', body: 'Booked for 11:00', created_at: '2026-11-07T05:30', patient_id: 'p1', patients: { full_name: 'Asha' } },
    { id: 2, phone: '919000000002', direction: 'in', body: 'Book me at 11', created_at: '2026-11-07T05:29', patient_id: null },
    { id: 1, phone: '919000000001', direction: 'out', body: 'Hello!', created_at: '2026-11-07T05:00', patient_id: null },
  ]
  const [a, b] = groupConversations(rows)
  assert.deepEqual([a.phone, a.count, a.fromThem, a.unanswered, a.patientId], ['919000000001', 2, 1, true, null])
  assert.deepEqual([b.phone, b.count, b.unanswered, b.patient], ['919000000002', 2, false, 'Asha'])
  assert.equal(groupConversations([]).length, 0)
})

test('only the end of a number is shown', () => {
  assert.equal(maskPhone('919632484104'), '•••• 4104')
  assert.equal(maskPhone('123'), '123')
  assert.equal(maskPhone(null), '')
})
