// The clinic records an age, not a date of birth. An age is only true on the
// day it was taken, so it is always stored with that date and aged forward
// from it. A date of birth, where one exists, always wins.
//
// Ageing forward is exact on each anniversary of the recording date and at
// most a year high in between: someone recorded as 47 has had their birthday
// within the previous twelve months, so a year later they are certainly 48,
// but today they may still be 47.
// A stored date is a clinic calendar date, so it is read as local midnight;
// `new Date('2025-11-07')` alone is UTC midnight, which is the previous day
// in timezones behind UTC.
const localDate = text => new Date(text + 'T00:00:00')

// Whole years from a past calendar date to today, counted on the calendar
// rather than in days, so it turns over on the anniversary itself rather than
// six hours into it. (The guardian check in migration 022 still counts in
// 365.25-day years; where the two disagree, for part of the anniversary day,
// the database is the stricter of the two and asks for a guardian.)
function yearsSince(date) {
  const now = new Date()
  let years = now.getFullYear() - date.getFullYear()
  const beforeAnniversary = now.getMonth() < date.getMonth()
    || (now.getMonth() === date.getMonth() && now.getDate() < date.getDate())
  return beforeAnniversary ? years - 1 : years
}

export function patientAge(patient) {
  if (!patient) return null
  if (patient.date_of_birth) {
    return { age: yearsSince(localDate(patient.date_of_birth)), exact: true, source: 'date of birth' }
  }
  if (patient.approx_age == null || !patient.approx_age_recorded_on) return null
  const elapsed = yearsSince(localDate(patient.approx_age_recorded_on))
  return {
    age: patient.approx_age + Math.max(0, elapsed),
    exact: elapsed === 0,
    source: 'age recorded ' + patient.approx_age_recorded_on,
    recordedAge: patient.approx_age,
    recordedOn: patient.approx_age_recorded_on,
  }
}

// Short label for a table cell or header: "47" when it was taken today,
// "~48" once it has been aged forward and could be a year out.
export function ageLabel(patient) {
  const a = patientAge(patient)
  if (!a) return null
  return a.exact ? String(a.age) : '~' + a.age
}

// Consent. An aged-forward figure is a lower bound: someone shown as 17 is
// 17 or 18, so they are treated as a minor; someone shown as 18 is 18 or 19
// and is not. Erring this way asks for a guardian a year too long rather
// than letting a 17-year-old sign for themselves.
export function isMinor(patient) {
  const a = patientAge(patient)
  if (!a) return null                       // unknown, which is not "adult"
  return a.age < 18
}
