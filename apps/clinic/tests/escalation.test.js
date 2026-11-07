import test from 'node:test'
import assert from 'node:assert/strict'
import { runTool } from '../api/_lib/booking-tools.js'

// A stand-in for the Supabase client that records what is written.
function fakeAdmin({ escalation_phone = null, bookingsError = null } = {}) {
  const inserted = []
  return {
    inserted,
    from: table => ({
      insert: async row => { inserted.push([table, row]); return { error: table === 'bookings' ? bookingsError : null } },
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { escalation_phone } }) }) }),
    }),
  }
}

async function withFetch(ok, fn) {
  const real = globalThis.fetch, calls = []
  process.env.WA_PHONE_NUMBER_ID = '1'; process.env.WA_ACCESS_TOKEN = 't'
  globalThis.fetch = async (url, init) => { calls.push(JSON.parse(init.body)); return { ok, json: async () => ({}) } }
  try { return [await fn(), calls] } finally { globalThis.fetch = real }
}

test('an escalation is always recorded for the front desk, even with no staff number set', async () => {
  const admin = fakeAdmin()
  const [result, sent] = await withFetch(true, () =>
    runTool(admin, { id: 'p1', full_name: 'Test Patient' }, '919999999999', 'escalate', { reason: 'bleeding after extraction' }))
  assert.deepEqual(result, { ok: true, recorded_for_front_desk: true, staff_alerted_on_whatsapp: false })
  assert.equal(sent.length, 0)
  const [table, row] = admin.inserted[0]
  assert.equal(table, 'bookings')
  assert.equal(row.patient_name, 'Test Patient')
  assert.match(row.reason, /^\[NEEDS STAFF\] bleeding after extraction/)
  assert.equal(row.status, 'new')
})

test('the WhatsApp alert is reported only when Meta accepted it', async () => {
  const [accepted] = await withFetch(true, () =>
    runTool(fakeAdmin({ escalation_phone: '919888888888' }), null, '919999999999', 'escalate', { reason: 'wants a discount' }))
  assert.equal(accepted.staff_alerted_on_whatsapp, true)
  const [refused, sent] = await withFetch(false, () =>
    runTool(fakeAdmin({ escalation_phone: '919888888888' }), null, '919999999999', 'escalate', { reason: 'wants a discount' }))
  assert.deepEqual(refused, { ok: true, recorded_for_front_desk: true, staff_alerted_on_whatsapp: false })
  assert.match(sent[0].text.body, /^\[ESCALATE\] 919999999999/)
})

test('if nothing could be recorded or sent, the assistant is told so', async () => {
  const [result] = await withFetch(false, () =>
    runTool(fakeAdmin({ bookingsError: { message: 'down' } }), null, '919999999999', 'escalate', { reason: 'pain' }))
  assert.equal(result.ok, false)
  assert.match(result.error, /call the clinic/)
})
