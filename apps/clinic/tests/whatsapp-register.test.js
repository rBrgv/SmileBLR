import test from 'node:test'
import assert from 'node:assert/strict'
import { buildTools, runTool, matchPatients, DAILY_REGISTRATION_CAP, WHATSAPP_SOURCE } from '../api/_lib/booking-tools.js'

// An in-memory stand-in for the Supabase client: just enough of the query
// builder for the functions under test, so their real logic runs.
function fakeAdmin(seed = {}) {
  const db = { patients: [], activity_log: [], ...seed }
  let n = 0
  return {
    db,
    from(table) {
      const rows = (db[table] ??= [])
      const filters = []
      let head = false, one = false, inserted = null, max = Infinity
      const b = {
        select(_cols, opts) { if (opts?.head) head = true; return b },
        is(col, v) { filters.push(r => (r[col] ?? null) === v); return b },
        eq(col, v) { filters.push(r => r[col] === v); return b },
        gte(col, v) { filters.push(r => r[col] >= v); return b },
        ilike(col, pattern) { const tail = pattern.replace(/^%/, '').toLowerCase(); filters.push(r => String(r[col] ?? '').toLowerCase().endsWith(tail)); return b },
        limit(k) { max = k; return b },
        single() { one = true; return b },
        insert(row) { inserted = row; return b },
        then(resolve) {
          if (inserted) {
            const row = { id: 'new-' + ++n, created_at: new Date().toISOString(), ...inserted }
            rows.push(row)
            return resolve({ data: one ? row : [row], error: null })
          }
          const found = rows.filter(r => filters.every(f => f(r))).slice(0, max)
          return resolve({ data: head ? null : one ? found[0] ?? null : found, count: found.length, error: null })
        },
      }
      return b
    },
  }
}
const person = (id, phone, extra = {}) => ({ id, full_name: 'Person ' + id, phone, merged_into: null, deleted_at: null, ...extra })

test('who is writing: one match is the sender, several is a shared phone, merged and archived do not count', async () => {
  const admin = fakeAdmin({ patients: [
    person('a', '9611234567'),
    person('b', '9000000001'), person('c', '9000000001'),
    person('d', '9000000002', { merged_into: 'a' }),
    person('e', '9000000003', { deleted_at: '2026-01-01' }),
  ] })
  assert.deepEqual((await matchPatients(admin, '919611234567')).map(p => p.id), ['a'])
  assert.deepEqual((await matchPatients(admin, '919000000001')).map(p => p.id).sort(), ['b', 'c'])
  assert.equal((await matchPatients(admin, '919000000002')).length, 0)
  assert.equal((await matchPatients(admin, '919000000003')).length, 0)
})

test('a stranger is registered on the number they are writing from, whatever they type', async () => {
  const admin = fakeAdmin()
  const result = await runTool(admin, null, '919611234567', 'create_patient', { full_name: '  Asha   Rao ', age: 34, phone: '9999999999' })
  assert.equal(result.ok, true)
  assert.equal(result.patient.full_name, 'Asha Rao')
  const row = admin.db.patients[0]
  assert.equal(row.phone, '9611234567', 'the number comes from WhatsApp, not from the message')
  assert.equal(row.referral_source, WHATSAPP_SOURCE)
  assert.equal(row.approx_age, 34)
  assert.ok(row.approx_age_recorded_on)
  assert.equal(row.consent_given, undefined, 'consent is never assumed')
  assert.equal(admin.db.activity_log[0].action, 'patient.registered_whatsapp')
})

test('an age that is not an age is left out, not stored', async () => {
  for (const age of [-3, 200, 'old', null]) {
    const admin = fakeAdmin()
    await runTool(admin, null, '919611234567', 'create_patient', { full_name: 'Test Person', age })
    assert.equal(admin.db.patients[0].approx_age, undefined, String(age))
  }
})

test('a name that is not a name is refused and nothing is written', async () => {
  for (const full_name of ['', ' ', 'x', '12345', '!!!', 'a'.repeat(81), undefined]) {
    const admin = fakeAdmin()
    const result = await runTool(admin, null, '919611234567', 'create_patient', { full_name })
    assert.equal(result.ok, false, String(full_name))
    assert.equal(admin.db.patients.length, 0)
  }
})

test('the daily cap stops the list being filled by one number-hopping caller', async () => {
  const now = new Date().toISOString()
  const full = Array.from({ length: DAILY_REGISTRATION_CAP }, (_, i) => person('w' + i, '98000000' + String(i).padStart(2, '0'), { referral_source: WHATSAPP_SOURCE, created_at: now }))
  const admin = fakeAdmin({ patients: full })
  const result = await runTool(admin, null, '919611234567', 'create_patient', { full_name: 'One More' })
  assert.equal(result.ok, false)
  assert.match(result.error, /front-desk/)
  assert.equal(admin.db.patients.length, DAILY_REGISTRATION_CAP)
})

test('registering twice does not create a second record, and a shared number is not guessed at', async () => {
  const admin = fakeAdmin({ patients: [person('a', '9611234567')] })
  const again = await runTool(admin, null, '919611234567', 'create_patient', { full_name: 'Someone Else' })
  assert.deepEqual([again.ok, again.patient.id, again.already_registered], [true, 'a', true])
  assert.equal(admin.db.patients.length, 1)

  const family = fakeAdmin({ patients: [person('b', '9000000001'), person('c', '9000000001')] })
  const refused = await runTool(family, null, '919000000001', 'create_patient', { full_name: 'Third Person' })
  assert.equal(refused.ok, false)
  assert.equal(family.db.patients.length, 2)
})

test('the tools offered depend on who is writing', () => {
  const names = tools => tools.map(t => t.function.name)
  const stranger = names(buildTools(null))
  assert.ok(stranger.includes('create_patient') && stranger.includes('create_lead') && stranger.includes('list_slots'))
  assert.ok(!stranger.includes('book_appointment'), 'a stranger cannot book until registered')

  const patient = names(buildTools({ id: 'a' }))
  assert.ok(patient.includes('book_appointment') && patient.includes('cancel_appointment'))
  assert.ok(patient.includes('create_lead'), 'booking for someone else goes to the front desk')
  assert.ok(!patient.includes('create_patient'))

  const shared = names(buildTools(null, { shared: true }))
  assert.ok(!shared.includes('book_appointment') && !shared.includes('create_patient') && !shared.includes('cancel_appointment'))
  assert.ok(shared.includes('create_lead') && shared.includes('escalate'))
})

test('after registration the same person can be booked', () => {
  const afterwards = buildTools({ id: 'new-1', full_name: 'Asha Rao', phone: '9611234567' }).map(t => t.function.name)
  assert.ok(afterwards.includes('book_appointment'))
})

test('a follow-up for someone else is recorded under their name, not the sender', async () => {
  const admin = fakeAdmin()
  const result = await runTool(admin, { id: 'a', full_name: 'Parent' }, '919611234567', 'create_lead', { full_name: 'Child Name', reason: 'cleaning' })
  assert.equal(result.ok, true)
  assert.equal(admin.db.bookings[0].patient_name, 'Child Name')
  assert.equal(admin.db.bookings[0].phone, '919611234567')
})
