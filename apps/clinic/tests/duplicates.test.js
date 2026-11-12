import test from 'node:test'
import assert from 'node:assert/strict'
import { normaliseName, duplicateGroups, describeData } from '../src/lib/duplicates.js'

const p = (id, name, created = '2026-01-01') => ({ id, full_name: name, created_at: created })

test('names match regardless of case, spacing and punctuation, but not on spelling', () => {
  assert.equal(normaliseName('  Asha   Rao '), normaliseName('asha rao'))
  assert.equal(normaliseName('D. Rao'), normaliseName('d rao'))
  assert.notEqual(normaliseName('Mohd Salman'), normaliseName('Mohammed Salman'))
  assert.equal(normaliseName(null), '')
})

test('only repeated names are grouped, alphabetically, with the busiest record suggested as the one to keep', () => {
  const groups = duplicateGroups(
    [p('1', 'Zara Khan'), p('2', 'asha rao', '2026-03-01'), p('3', 'Asha Rao', '2026-02-01'), p('4', 'Zara  Khan'), p('5', 'Only One'), p('6', '   '), p('7', '')],
    { 2: { records: 12, bills: 1 }, 4: { appointments: 2 } },
  )
  assert.deepEqual(groups.map(g => g.name), ['asha rao', 'Zara Khan'].sort((a, b) => a.localeCompare(b)))
  const asha = groups.find(g => g.key === 'asharao')
  assert.equal(asha.keep, '2', 'the record with the treatment history is kept')
  assert.deepEqual(asha.members.map(m => m.id), ['2', '3'])
  const zara = groups.find(g => g.key === 'zarakhan')
  assert.equal(zara.keep, '4', 'a record with an appointment beats one with nothing')
})

test('with nothing recorded on either, the one registered first is suggested', () => {
  const [g] = duplicateGroups([p('late', 'Same Name', '2026-05-01'), p('early', 'Same Name', '2026-01-01')])
  assert.equal(g.keep, 'early')
})

test('what a record holds is described in words', () => {
  assert.equal(describeData({ records: 12, bills: 1, appointments: 0 }), '12 treatments · 1 bill')
  assert.equal(describeData({}), 'nothing recorded')
  assert.equal(describeData(undefined), 'nothing recorded')
})
