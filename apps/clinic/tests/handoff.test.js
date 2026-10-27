import test from 'node:test'
import assert from 'node:assert/strict'
import { appointmentTimes, localDate, billed, received, balance, fetchAll } from '../src/lib/handoff.js'
import { parseCSV, parseDate, parseBool, buildPatientRow } from '../src/lib/patientImport.js'

test('recurring appointments retain IST date/time and clamp month-end', () => {
  const weekly = appointmentTimes('2026-09-14', '10:00', 'weekly', 3).map(t => new Date(t))
  assert.deepEqual(weekly.map(localDate), ['2026-09-14', '2026-09-21', '2026-09-28'])
  assert.ok(weekly.every(d => d.getHours() === 10))
  assert.deepEqual(appointmentTimes('2028-01-31', '10:00', 'monthly', 3).map(t => localDate(new Date(t))), ['2028-01-31', '2028-02-29', '2028-03-31'])
  assert.equal(localDate(new Date('2026-09-13T20:00:00Z')), '2026-09-14')
  assert.throws(() => appointmentTimes('', '', 'weekly', 2))
  assert.throws(() => appointmentTimes('2026-09-14', '10:00', 'weekly', 25))
})
test('partial payments include tax and full refunds close the balance', () => {
  const inv = { amount: 10000, tax_amount: 1800, amount_paid: 4000, payment_status: 'partial' }
  assert.equal(billed(inv), 11800); assert.equal(received(inv), 4000); assert.equal(balance(inv), 7800)
  assert.equal(balance({ ...inv, amount_paid: 0, payment_status: 'refunded' }), 0)
  assert.equal(balance({ amount: .3, amount_paid: .1 }), .2)
})
test('pagination continues through server caps smaller than requested page size', async () => {
  const source = Array.from({ length: 825 }, (_, id) => ({ id }))
  const all = await fetchAll(() => ({ range: async (from, to) => ({ data: source.slice(from, Math.min(to + 1, from + 100)) }) }))
  assert.equal(all.length, 825); assert.equal(all.at(-1).id, 824)
  await assert.rejects(fetchAll(() => ({ range: async () => ({ error: new Error('offline') }) })), /offline/)
})
test('Click4 import preserves missing phones and quoted source fields without fabricating consent', () => {
  const [r] = parseCSV('\uFEFFPatient ID,Full Name,Phone Number,Medical History Summary\r\n42,"Example, Patient",,"Line one\nLine ""two"""\r\n')
  const patient = buildPatientRow(r)
  assert.equal(r.source_id, '42'); assert.equal(patient.phone, null); assert.equal(patient.consent_given, false)
  assert.equal(patient.import_source['medical history summary'], 'Line one\nLine "two"')
  assert.throws(() => parseCSV('full_name,phone\n"unterminated'), /Unclosed/)
  assert.throws(() => parseCSV('full_name,phone,Phone Number\nA,1,1'), /Duplicate/)
  assert.throws(() => parseDate('31-02-2026'), /Invalid date/)
  assert.equal(parseDate('29/02/2028'), '2028-02-29')
  assert.throws(() => parseBool('unknown'), /Unrecognized/)
})
