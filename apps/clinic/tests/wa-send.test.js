import test from 'node:test'
import assert from 'node:assert/strict'
import { waNumber, sendText, sendWhatsApp } from '../api/_lib/wa.js'
import { isUrgent } from '../api/_lib/booking-tools.js'

test('a stored phone number becomes one Meta accepts', () => {
  assert.equal(waNumber('9611234567'), '919611234567')
  assert.equal(waNumber('096112 34567'), '919611234567')
  assert.equal(waNumber('+91 96112 34567'), '919611234567')
  assert.equal(waNumber('919611234567'), '919611234567')
  assert.equal(waNumber('+44 7911 123456'), '447911123456')
  for (const bad of ['N/A', '', null, undefined, '12345', '961123456']) assert.equal(waNumber(bad), null)
})

test('both senders put the country code on the wire, and refuse a non-number without calling Meta', async () => {
  const real = globalThis.fetch, bodies = []
  process.env.WA_PHONE_NUMBER_ID = '1'; process.env.WA_ACCESS_TOKEN = 't'
  globalThis.fetch = async (_url, init) => { bodies.push(JSON.parse(init.body)); return { ok: true, json: async () => ({}) } }
  try {
    await sendText('9611234567', 'hi')
    await sendWhatsApp('9611234567', 'recall_reminder', ['A'])
    assert.deepEqual(bodies.map(b => b.to), ['919611234567', '919611234567'])
    const refused = await sendText('N/A', 'hi')
    assert.equal(refused.ok, false)
    assert.equal(bodies.length, 2, 'nothing was sent for a number that is not one')
  } finally { globalThis.fetch = real }
})

test('words that mean a person should look are caught, ordinary requests are not', () => {
  for (const text of [
    'My name is Harry Potter and my gums are bleeding can I visit today',
    'severe toothache since last night', 'my face is swollen', 'I knocked my front tooth out',
    'there is pus near my wisdom tooth', 'i have a fever after the extraction', "I can't open my mouth",
    'I broke a tooth', 'is this an emergency',
  ]) assert.equal(isUrgent(text), true, text)
  for (const text of [
    'Hello', 'What time are you open', 'Can I book a slot tomorrow at 11',
    'How much is a root canal', 'I want to cancel my appointment', 'do you do teeth whitening',
  ]) assert.equal(isUrgent(text), false, text)
})
