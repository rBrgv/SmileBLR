import test from 'node:test'
import assert from 'node:assert/strict'
import { invoiceLinesFrom, billedRecords } from '../src/lib/records.js'

test('an invoice line takes the procedure\'s own cost, and only then the list price', () => {
  const lines = invoiceLinesFrom([
    { id: 'a', tooth_number: 14, amount: '5000.00', treatments: { name: 'Crown', price_min: 4000 } },
    { id: 'b', tooth_number: null, amount: null, treatments: { name: 'Scaling', price_min: 1200 } },
    { id: 'c', amount: null, notes: 'Consult', treatments: null },
  ])
  assert.deepEqual(lines.map(l => [l.description, l.unit_price, l.tooth_number]), [['Crown', 5000, 14], ['Scaling', 1200, ''], ['Consult', 0, '']])
  assert.deepEqual(lines.map(l => l.treatment_record_id), ['a', 'b', 'c'])
  assert.ok(lines.every(l => l.quantity === 1 && l.discount === 0 && typeof l.unit_price === 'number'))
})

test('records already on an invoice are found, so a procedure is not billed twice', () => {
  const inv1 = { id: 'i1', invoice_number: 26, items: [{ description: 'Crown', treatment_record_id: 'a' }, { description: 'Manual line' }] }
  const inv2 = { id: 'i2', invoice_number: 27, items: null }
  const map = billedRecords([inv1, inv2])
  assert.equal(map.a, inv1)
  assert.equal(map.b, undefined)
  assert.deepEqual(Object.keys(map), ['a'])
})
