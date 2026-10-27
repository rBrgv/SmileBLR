// Reconciles the Click4Appointment patient export against the app's patients.
// The first 825 were imported by an older screen that stored no source ID, so
// treatment history has nothing to join on until import_key is backfilled.
//
// Read-only. It writes two review files and never touches the database:
//   data/import/patient-matches.csv       what a backfill would set
//   data/import/patient-review.csv        everything it refuses to guess
//
// Run from apps/clinic:
//   node --env-file=.env.import scripts/reconcile-patients.mjs
//
// Auto-matches only on normalized name + phone, or on a name that is unique in
// both systems. Anything else is reported, never guessed.
import { createClient } from '@supabase/supabase-js'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '../../../data/import')
const URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!URL || !KEY) { console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required'); process.exit(1) }
const sb = createClient(URL, KEY)

function parseCSV(text) {
  const rows = []
  let row = [], field = '', inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++ } else inQuotes = false }
      else field += c
    } else if (c === '"') inQuotes = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field); field = ''
      if (row.length > 1 || row[0] !== '') rows.push(row)
      row = []
    } else field += c
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row) }
  const headers = rows[0].map(h => h.trim().replace(/^﻿/, ''))
  return rows.slice(1).map(r => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? '').trim()])))
}

const nameKey = s => (s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
// 'N/A' is the placeholder the old import screen wrote for a missing number.
const phoneKey = s => {
  const d = (s || '').replace(/\D/g, '')
  return d.length >= 10 ? d.slice(-10) : ''
}

const source = parseCSV(readFileSync(join(dataDir, 'click4appointment_patient_export_2026-10-26.csv'), 'utf8'))
// What treatment history is riding on each decision.
const treatmentLines = parseCSV(readFileSync(join(dataDir, 'click4appointment_treatments_FINAL.csv'), 'utf8'))
const sourceTreatments = new Map()
for (const l of treatmentLines) {
  const id = l['Patient ID']
  if (!id) continue
  if (!sourceTreatments.has(id)) sourceTreatments.set(id, { lines: 0, plans: new Set() })
  const t = sourceTreatments.get(id)
  t.lines++
  t.plans.add(l['Internal Plan ID'])
}
const treatmentSummary = id => {
  const t = sourceTreatments.get(id)
  return t ? `${t.lines} lines / ${t.plans.size} plans` : 'none'
}
const previous = parseCSV(readFileSync(join(dataDir, 'click4appointment_patient_export_FINAL.csv'), 'utf8'))
const previousById = new Map(previous.map(r => [r['Patient ID'], r]))

async function readAll(table, columns) {
  const out = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from(table).select(columns).range(from, from + 999)
    if (error) { console.error(`Reading ${table}:`, error.message); process.exit(1) }
    out.push(...data)
    if (data.length < 1000) break
  }
  return out
}
const db = await readAll('patients', 'id, full_name, phone, gender, import_key, created_at, merged_into')
const tally = rows => rows.reduce((m, r) => m.set(r.patient_id, (m.get(r.patient_id) || 0) + 1), new Map())
const apptCount = tally(await readAll('appointments', 'patient_id'))
const recordCount = tally(await readAll('treatment_records', 'patient_id'))
const invoiceCount = tally(await readAll('invoices', 'patient_id'))

const dbByNamePhone = new Map(), dbByName = new Map()
for (const p of db) {
  const n = nameKey(p.full_name), ph = phoneKey(p.phone)
  if (ph) {
    const k = `${n}|${ph}`
    if (!dbByNamePhone.has(k)) dbByNamePhone.set(k, [])
    dbByNamePhone.get(k).push(p)
  }
  if (!dbByName.has(n)) dbByName.set(n, [])
  dbByName.get(n).push(p)
}
const sourceNameCounts = new Map()
for (const r of source) sourceNameCounts.set(nameKey(r['Full Name']), (sourceNameCounts.get(nameKey(r['Full Name'])) || 0) + 1)

const matched = [], toCreate = [], review = []
const claimedDbIds = new Set()

for (const r of source) {
  const sourceId = r['Patient ID'], n = nameKey(r['Full Name']), ph = phoneKey(r['Phone Number'])
  const wasInPreviousExport = previousById.has(sourceId)
  const changed = wasInPreviousExport && JSON.stringify(previousById.get(sourceId)) !== JSON.stringify(r)

  const byNamePhone = ph ? (dbByNamePhone.get(`${n}|${ph}`) ?? []) : []
  const byName = dbByName.get(n) ?? []

  let hit = null, rule = null
  if (byNamePhone.length === 1) { hit = byNamePhone[0]; rule = 'name + phone' }
  else if (byNamePhone.length > 1) rule = 'ambiguous: several app records share this name and phone'
  else if (byName.length === 1 && sourceNameCounts.get(n) === 1) { hit = byName[0]; rule = 'name unique in both systems' }
  else if (byName.length === 0) rule = 'no app record'
  else rule = byName.length > 1 ? 'ambiguous: name repeats in the app' : 'ambiguous: name repeats in the export'

  const row = { source_id: sourceId, name: r['Full Name'], phone: r['Phone Number'] || '(none)', rule,
    source_registered: r['Registration Date'] || '', source_gender: r['Gender'] || '', source_age: r['Age'] || '',
    app_created: hit?.created_at?.slice(0, 10) ?? '', app_gender: hit?.gender ?? '',
    app_patient_id: hit?.id ?? '', app_name: hit?.full_name ?? '', app_phone: hit?.phone ?? '',
    changed_since_last_export: changed ? 'yes' : 'no' }

  // A name-only match is only trusted when nothing contradicts it. Phone and
  // gender are the two fields both systems hold for the same person.
  //
  // Registration date is deliberately NOT used: the app never stored it, and
  // created_at for the bulk-imported patients is the import day (2026-09-12),
  // so comparing the two measures when the CSV was loaded, not who the
  // patient is. It is reported below, never acted on.
  let contradiction = null
  if (hit && rule !== 'name + phone') {
    const hitPhone = phoneKey(hit.phone)
    if (ph && hitPhone && ph !== hitPhone) contradiction = 'conflict: name matches but phone numbers differ'
    const sg = (r['Gender'] || '').toLowerCase(), dg = (hit.gender || '').toLowerCase()
    if (!contradiction && sg && dg && sg !== dg) contradiction = 'conflict: name matches but gender differs'
  }

  if (hit && contradiction) review.push({ ...row, rule: contradiction })
  else if (hit) {
    if (claimedDbIds.has(hit.id)) { review.push({ ...row, rule: 'ambiguous: app record already claimed by another source row', app_patient_id: hit.id }) }
    else { claimedDbIds.add(hit.id); matched.push(row, ) }
  } else if (rule === 'no app record') toCreate.push(row)
  else review.push(row)
}

// An app record can go unclaimed for three different reasons, and lumping
// them together would overstate how many patients Click4Appointment dropped.
const unclaimed = db.filter(p => !claimedDbIds.has(p.id))
const reviewNames = new Set(review.map(r => nameKey(r.name)))
const sourceNames = new Set(source.map(r => nameKey(r['Full Name'])))
const previousNames = new Set(previous.map(r => nameKey(r['Full Name'])))
const heldForReview = unclaimed.filter(p => reviewNames.has(nameKey(p.full_name)))
const stillInExport = unclaimed.filter(p => !reviewNames.has(nameKey(p.full_name)) && sourceNames.has(nameKey(p.full_name)))
const droppedFromExport = unclaimed.filter(p => !reviewNames.has(nameKey(p.full_name)) && !sourceNames.has(nameKey(p.full_name)) && previousNames.has(nameKey(p.full_name)))
const appOnly = unclaimed.filter(p => !reviewNames.has(nameKey(p.full_name)) && !sourceNames.has(nameKey(p.full_name)) && !previousNames.has(nameKey(p.full_name)))

const pct = n => `${((n / source.length) * 100).toFixed(1)}%`
console.log(`\n=== Patient reconciliation — DRY RUN (nothing written) ===\n`)
console.log(`Source export rows        ${source.length}`)
console.log(`App patient records       ${db.length}   (${db.filter(p => p.import_key).length} already carry an import_key)`)
console.log(`\nHow the ${source.length} source patients split:`)
console.log(`  matched to an app record   ${String(matched.length).padStart(4)}  ${pct(matched.length)}`)
console.log(`    by name + phone          ${String(matched.filter(m => m.rule === 'name + phone').length).padStart(4)}`)
console.log(`    by name unique in both   ${String(matched.filter(m => m.rule !== 'name + phone').length).padStart(4)}`)
console.log(`  no app record -> create    ${String(toCreate.length).padStart(4)}  ${pct(toCreate.length)}`)
console.log(`  needs review               ${String(review.length).padStart(4)}  ${pct(review.length)}`)
console.log(`  changed since last export  ${String(source.filter(r => previousById.has(r['Patient ID']) && JSON.stringify(previousById.get(r['Patient ID'])) !== JSON.stringify(r)).length).padStart(4)}`)

console.log(`\nWhy ${db.length} app records + ${toCreate.length} new exceeds ${source.length} source patients:`)
console.log(`  app records claimed by a source row       ${String(claimedDbIds.size).padStart(4)}`)
console.log(`  app records left unclaimed                ${String(unclaimed.length).padStart(4)}`)
console.log(`    held back by a review case              ${String(heldForReview.length).padStart(4)}  (same name as a row needing review)`)
console.log(`    name still in the export, not matched   ${String(stillInExport.length).padStart(4)}`)
console.log(`    dropped from Click4Appointment          ${String(droppedFromExport.length).padStart(4)}  (in the old export, gone from the new)`)
console.log(`    never in either export                  ${String(appOnly.length).padStart(4)}  (created inside the app)`)
console.log(`  => ${claimedDbIds.size} + ${unclaimed.length} = ${db.length} today; + ${toCreate.length} new = ${db.length + toCreate.length}.`)
console.log(`  The export is a snapshot of one system; the app also holds records it never had.`)

// Reported, never acted on — see the note where contradictions are detected.
const nameOnly = matched.filter(m => m.rule !== 'name + phone')
const dayGap = m => {
  const d = (m.source_registered || '').match(/^(\d{2})-(\d{2})-(\d{4})$/)
  if (!d || !m.app_created) return null
  return Math.abs(new Date(m.app_created) - new Date(`${d[3]}-${d[2]}-${d[1]}`)) / 864e5
}
const wideGap = nameOnly.filter(m => (dayGap(m) ?? 0) > 30)
console.log(`\nName-only matches: ${nameOnly.length}`)
console.log(`  demoted for a phone conflict   ${review.filter(r => r.rule.startsWith('conflict: name matches but phone')).length}`)
console.log(`  demoted for a gender conflict  ${review.filter(r => r.rule.startsWith('conflict: name matches but gender')).length}`)
console.log(`  app created_at more than 30 days from the source registration date: ${wideGap.length}`)
console.log(`    (not a demotion: created_at is the import day for the bulk-loaded patients)`)

const SAMPLE = Number((process.argv.find(a => a.startsWith('--sample=')) || '').split('=')[1] || 0)
if (SAMPLE) {
  const pick = [...nameOnly].sort(() => Math.random() - 0.5).slice(0, SAMPLE)
  console.log(`\n=== Spot-check: ${pick.length} random name-only matches (no phone numbers) ===`)
  console.log(`  ${'source'.padEnd(7)} ${'name'.padEnd(28)} ${'registered'.padEnd(11)} ${'app created'.padEnd(12)} gender`)
  for (const m of pick) {
    const g = m.source_gender === m.app_gender ? m.source_gender || '-' : `${m.source_gender || '-'} / app: ${m.app_gender || '-'}`
    console.log(`  ${m.source_id.padEnd(7)} ${m.name.slice(0, 28).padEnd(28)} ${m.source_registered.padEnd(11)} ${m.app_created.padEnd(12)} ${g}`)
  }
}

const reviewReasons = review.reduce((a, r) => ({ ...a, [r.rule]: (a[r.rule] || 0) + 1 }), {})
if (review.length) {
  console.log(`\nReview reasons:`)
  for (const [k, v] of Object.entries(reviewReasons)) console.log(`  ${String(v).padStart(4)}  ${k}`)
}

// These two files carry names and phone numbers by necessity — the clinic
// cannot adjudicate a match without them. data/import/ is gitignored.
const write = (file, rows, cols) => {
  const csv = [cols.join(','), ...rows.map(r => cols.map(c => {
    const v = String(r[c] ?? '')
    return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
  }).join(','))].join('\n')
  writeFileSync(join(dataDir, file), csv + '\n')
  console.log(`Wrote data/import/${file} (${rows.length} rows)`)
}
const cols = ['source_id', 'name', 'phone', 'rule', 'app_patient_id', 'app_name', 'app_phone',
  'source_registered', 'source_gender', 'app_created', 'app_gender', 'changed_since_last_export']
console.log()
write('patient-matches.csv', matched, cols)
write('patient-new.csv', toCreate, cols)

// patient-review.csv is the sheet the clinic fills in: one row per source
// patient, every app record that could be them laid out side by side, and an
// empty column for the decision. Activity counts are there so they can tell a
// real record from an empty duplicate.
const activity = p => `${apptCount.get(p.id) || 0} appt / ${recordCount.get(p.id) || 0} treat / ${invoiceCount.get(p.id) || 0} inv`
const reviewRows = review.map(r => {
  const candidates = (dbByName.get(nameKey(r.name)) ?? [])
  const row = {
    source_id: r.source_id, source_name: r.name, source_phone: r.phone,
    source_registered: r.source_registered, source_gender: r.source_gender,
    source_age: r.source_age, source_treatments: treatmentSummary(r.source_id),
    why_flagged: r.rule, candidates: candidates.length, chosen_app_record: '',
  }
  candidates.forEach((c, i) => {
    const n = i + 1
    row[`candidate_${n}_app_id`] = c.id
    row[`candidate_${n}_name`] = c.full_name
    row[`candidate_${n}_phone`] = c.phone ?? ''
    row[`candidate_${n}_gender`] = c.gender ?? ''
    row[`candidate_${n}_created`] = c.created_at.slice(0, 10)
    row[`candidate_${n}_activity`] = activity(c)
  })
  return row
})
const maxCandidates = Math.max(0, ...reviewRows.map(r => r.candidates))
const reviewCols = ['source_id', 'source_name', 'source_phone', 'source_registered', 'source_gender',
  'source_age', 'source_treatments', 'why_flagged', 'candidates', 'chosen_app_record']
for (let n = 1; n <= maxCandidates; n++) {
  reviewCols.push(`candidate_${n}_app_id`, `candidate_${n}_name`, `candidate_${n}_phone`,
    `candidate_${n}_gender`, `candidate_${n}_created`, `candidate_${n}_activity`)
}
write('patient-review.csv', reviewRows, reviewCols)
console.log(`  review sheet: up to ${maxCandidates} candidates per row; fill in "chosen_app_record" (paste a candidate app id, or write NEW)`)
console.log(`\nNo import_key written. Review patient-matches.csv before any backfill.\n`)
