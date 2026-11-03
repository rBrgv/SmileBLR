import test from 'node:test'
import assert from 'node:assert/strict'
import { rupeesInWords, numberInWords } from '../src/lib/words.js'

test('amounts are spelled out the way an Indian receipt reads', () => {
  assert.equal(rupeesInWords(0), 'Rupees Zero Only')
  assert.equal(rupeesInWords(7), 'Rupees Seven Only')
  assert.equal(rupeesInWords(15), 'Rupees Fifteen Only')
  assert.equal(rupeesInWords(90), 'Rupees Ninety Only')
  assert.equal(rupeesInWords(118), 'Rupees One Hundred and Eighteen Only')
  assert.equal(rupeesInWords(600), 'Rupees Six Hundred Only')
  assert.equal(rupeesInWords(1050), 'Rupees One Thousand and Fifty Only')
  assert.equal(rupeesInWords(4550), 'Rupees Four Thousand Five Hundred and Fifty Only')
  assert.equal(rupeesInWords(12000), 'Rupees Twelve Thousand Only')
  // Indian grouping: 1,50,000 is one lakh fifty thousand, not a hundred and
  // fifty thousand.
  assert.equal(rupeesInWords(150000), 'Rupees One Lakh Fifty Thousand Only')
  assert.equal(rupeesInWords(2375000), 'Rupees Twenty Three Lakh Seventy Five Thousand Only')
  assert.equal(rupeesInWords(10000000), 'Rupees One Crore Only')
  assert.equal(rupeesInWords(1234567890), 'Rupees One Hundred Twenty Three Crore Forty Five Lakh Sixty Seven Thousand Eight Hundred and Ninety Only')
  // Paise, rounding, and a negative (a refund line prints its own label).
  assert.equal(rupeesInWords(118.5), 'Rupees One Hundred and Eighteen and Fifty Paise Only')
  assert.equal(rupeesInWords(99.994), 'Rupees Ninety Nine and Ninety Nine Paise Only')
  assert.equal(rupeesInWords(0.005), 'Rupees Zero and One Paise Only')
  assert.equal(rupeesInWords(-2500), 'Rupees Two Thousand Five Hundred Only')
  assert.equal(rupeesInWords(null), 'Rupees Zero Only')
  assert.equal(numberInWords(21), 'Twenty One')
})
