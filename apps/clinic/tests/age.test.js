import { test } from 'node:test'
import assert from 'node:assert/strict'
import { patientAge, ageLabel, isMinor } from '../src/lib/age.js'

const daysAgo = n => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10)
const yearsAgo = n => daysAgo(Math.round(n * 365.25))

test('a date of birth wins and is exact', () => {
  const dob = new Date(); dob.setFullYear(dob.getFullYear() - 30); dob.setDate(dob.getDate() - 1)
  const a = patientAge({ date_of_birth: dob.toISOString().slice(0, 10), approx_age: 99, approx_age_recorded_on: daysAgo(0) })
  assert.equal(a.age, 30)
  assert.equal(a.exact, true)
  assert.equal(ageLabel({ date_of_birth: dob.toISOString().slice(0, 10) }), '30')
})

test('an age recorded today is shown as given', () => {
  const p = { approx_age: 47, approx_age_recorded_on: daysAgo(0) }
  assert.equal(patientAge(p).age, 47)
  assert.equal(ageLabel(p), '47')
})

test('an age ages forward, and is marked as inexact once it does', () => {
  const p = { approx_age: 47, approx_age_recorded_on: yearsAgo(1) }
  assert.equal(patientAge(p).age, 48)
  assert.equal(ageLabel(p), '~48')
  assert.equal(patientAge({ approx_age: 47, approx_age_recorded_on: yearsAgo(3) }).age, 50)
})

test('part of a year does not add a year', () => {
  assert.equal(patientAge({ approx_age: 47, approx_age_recorded_on: daysAgo(200) }).age, 47)
})

test('nothing recorded reads as unknown, not as an adult', () => {
  assert.equal(patientAge({}), null)
  assert.equal(ageLabel({}), null)
  assert.equal(isMinor({}), null)
  assert.equal(isMinor({ approx_age: 12 }), null)   // no recorded date, unusable
})

test('a borderline age counts as a minor, an adult does not', () => {
  assert.equal(isMinor({ approx_age: 7, approx_age_recorded_on: daysAgo(0) }), true)
  assert.equal(isMinor({ approx_age: 17, approx_age_recorded_on: daysAgo(0) }), true)
  // recorded 17 a year ago: now 18 or 19, so no longer treated as a minor
  assert.equal(isMinor({ approx_age: 17, approx_age_recorded_on: yearsAgo(1) }), false)
  assert.equal(isMinor({ approx_age: 18, approx_age_recorded_on: daysAgo(0) }), false)
})
