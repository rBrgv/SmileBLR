import test from 'node:test'
import assert from 'node:assert/strict'
import { invoiceLinesFrom, billedRecords, recordTotal, recordTotals } from '../src/lib/records.js'

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

test('a line is units at the cost each, less its discount, and unknown when it has no cost', () => {
  assert.equal(recordTotal({ amount: '5000.00', units: 2, discount: '500.00' }), 9500)
  assert.equal(recordTotal({ amount: 800 }), 800, 'units default to one, discount to none')
  assert.equal(recordTotal({ amount: 0.1, units: 3 }), 0.3, 'no floating point drift')
  assert.equal(recordTotal({ amount: null, units: 2 }), null)
})

test('totals leave out work that was not treated and say what they could not count', () => {
  assert.deepEqual(
    recordTotals([
      { amount: 5000, units: 2, discount: 500 },
      { amount: 1000 },
      { amount: null },
      { amount: 900, status: 'not_treated' },
    ]),
    { cost: 11000, discount: 500, grand: 10500, missing: 1 },
  )
  assert.deepEqual(recordTotals([]), { cost: 0, discount: 0, grand: 0, missing: 0 })
})

test('billing a line carries its units and discount onto the invoice', () => {
  const [line] = invoiceLinesFrom([{ id: 'a', amount: '5000', units: 2, discount: '500', treatments: { name: 'Filling' }, tooth_number: 26 }])
  assert.deepEqual([line.quantity, line.unit_price, line.discount], [2, 5000, 500])
})
