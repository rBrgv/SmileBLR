// The clinic records an age, not a date of birth. An age is only true on the
// day it was taken, so it is always stored with that date and aged forward
// from it. A date of birth, where one exists, always wins.
//
// Ageing forward is exact on each anniversary of the recording date and at
// most a year high in between: someone recorded as 47 has had their birthday
// within the previous twelve months, so a year later they are certainly 48,
// but today they may still be 47.
const YEAR = 365.25 * 24 * 3600 * 1000

export function patientAge(patient) {
  if (!patient) return null
  if (patient.date_of_birth) {
    const dob = new Date(patient.date_of_birth)
    const now = new Date()
    let age = now.getFullYear() - dob.getFullYear()
    const beforeBirthday = now.getMonth() < dob.getMonth()
      || (now.getMonth() === dob.getMonth() && now.getDate() < dob.getDate())
    if (beforeBirthday) age--
    return { age, exact: true, source: 'date of birth' }
  }
  if (patient.approx_age == null || !patient.approx_age_recorded_on) return null
  const elapsed = Math.floor((Date.now() - new Date(patient.approx_age_recorded_on)) / YEAR)
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
