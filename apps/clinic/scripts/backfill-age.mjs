// Fills patients.approx_age / approx_age_recorded_on with the age exactly as
// Click4Appointment recorded it, taken from patients.import_source. Nothing is
// derived: "47" in the export is stored as 47.
// date_of_birth is never written: an age is not a birth date, and staff
// confirm the real one at the next visit.
//
//   node --env-file=.env.import scripts/backfill-age.mjs            # dry run
//   node --env-file=.env.import scripts/backfill-age.mjs --apply
//
// Requires migration 021. Idempotent: a patient who already has a source age,
// or a confirmed date of birth, is left alone. Counts only, no names.
import { createClient } from '@supabase/supabase-js'

const APPLY = process.argv.includes('--apply')
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

// The export this came from; the age is true as of the day it was taken.
const RECORDED_ON = '2026-10-26'

const patients = []
for (let from = 0; ; from += 1000) {
  const { data, error } = await sb.from('patients')
    .select('id, date_of_birth, approx_age, import_source').range(from, from + 999)
  if (error) { console.error('Reading patients:', error.message); process.exit(1) }
  patients.push(...data)
  if (data.length < 1000) break
}

const planned = [], skipped = { noSource: 0, noAge: 0, unusableAge: 0, hasDob: 0, alreadySet: 0 }
for (const p of patients) {
  if (!p.import_source) { skipped.noSource++; continue }
  const raw = p.import_source['Age']
  if (!raw) { skipped.noAge++; continue }
  const age = parseInt(raw, 10)
  if (!Number.isFinite(age) || age < 0 || age > 120) { skipped.unusableAge++; continue }
  if (p.date_of_birth) { skipped.hasDob++; continue }      // a real date wins
  if (p.approx_age !== null && p.approx_age !== undefined) { skipped.alreadySet++; continue }
  planned.push({ id: p.id, approx_age: age })
}

const buckets = planned.reduce((a, r) => {
  const b = r.approx_age < 18 ? 'under 18' : r.approx_age < 60 ? '18-59' : '60+'
  a[b] = (a[b] || 0) + 1
  return a
}, {})

console.log(`\n=== Recorded age backfill — ${APPLY ? 'APPLY' : 'DRY RUN'} ===\n`)
console.log(`Patients                      ${patients.length}`)
console.log(`Would set approx_age          ${planned.length}   (exactly as recorded on ${RECORDED_ON})`)
for (const [k, v] of Object.entries(buckets).sort()) console.log(`    ${k.padEnd(10)} ${String(v).padStart(4)}`)
console.log(`Skipped:`)
console.log(`  no source row stored        ${skipped.noSource}`)
console.log(`  source row has no age       ${skipped.noAge}`)
console.log(`  age unusable                ${skipped.unusableAge}`)
console.log(`  already has a date of birth ${skipped.hasDob}`)
console.log(`  source age already set      ${skipped.alreadySet}`)
console.log(`date_of_birth written          0   (never)`)

if (!APPLY) {
  console.log(`\nNothing written. Re-run with --apply.\n`)
  process.exit(0)
}

let done = 0
for (const row of planned) {
  const { error } = await sb.from('patients')
    .update({ approx_age: row.approx_age, approx_age_recorded_on: RECORDED_ON }).eq('id', row.id)
  if (error) { console.error(`  ${row.id}: ${error.message}`); continue }
  done++
}
const { count } = await sb.from('patients').select('*', { count: 'exact', head: true }).not('approx_age', 'is', null)
console.log(`\nSet on ${done} patients. Database now holds ${count} recorded ages.\n`)
