// Vitals are a measurement rather than a clinical judgement, and in the chair
// it is usually the assistant taking them — so assistants may record them,
// unlike the rest of the clinical record. Matches the policies in 028.
export const canRecordVitals = role => role === 'admin' || role === 'doctor' || role === 'assistant'

const n = v => v == null ? null : Number(v)

// One reading, formatted the way it is spoken: "120/80", "98.4 °F".
export function vitalsSummary(v) {
  const sugar = n(v.blood_sugar)
  return {
    bp: v.bp_systolic ? `${v.bp_systolic}/${v.bp_diastolic}` : '—',
    pulse: v.pulse ? `${v.pulse}/min` : '—',
    temperature: v.temperature_f ? `${n(v.temperature_f)} °F` : '—',
    spo2: v.spo2 ? `${v.spo2}%` : '—',
    sugar: sugar == null ? '—' : `${sugar} mg/dL${v.sugar_timing ? ' (' + v.sugar_timing.replace('_', ' ') + ')' : ''}`,
    weight: v.weight_kg ? `${n(v.weight_kg)} kg` : '—',
  }
}

// What a dentist wants flagged before picking up a handpiece. Deliberately
// cautious and few: these are reasons to pause and check, not diagnoses.
export function vitalsFlags(v) {
  const flags = []
  if (v.bp_systolic >= 160 || v.bp_diastolic >= 100) flags.push('Blood pressure high')
  if (v.bp_systolic && v.bp_systolic < 90) flags.push('Blood pressure low')
  if (v.pulse && (v.pulse > 110 || v.pulse < 50)) flags.push('Pulse outside the usual range')
  if (n(v.temperature_f) >= 100.4) flags.push('Febrile')
  if (v.spo2 && v.spo2 < 94) flags.push('SpO₂ low')
  const sugar = n(v.blood_sugar)
  if (sugar != null && (sugar >= 250 || sugar < 70)) flags.push('Blood sugar outside the usual range')
  return flags
}
