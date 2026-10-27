// Decides, for each of the 916 source patients, which app record it is —
// without clinic input. Dry run only: writes decision files, never the database.
//
//   node --env-file=.env.import scripts/resolve-patients.mjs
//
// Rules, in order (first one that fires wins):
//   name+phone   already matched on normalized name + phone
//   name-unique  name unique in both systems, nothing contradicting
//   a  a candidate carries the same phone as the source
//   b  phones unusable; exactly one candidate agrees on gender AND age
//   c  insertion order: the 825 bulk-imported rows went in in CSV order
//      (verified 99.7% consistent), so the app record whose position matches
//      the source row is the same person
//   d  anything else -> NEW
//
// Prints counts only. No names, no phone numbers.
import { createClient } from '@supabase/supabase-js'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '../../../data/import')
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

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
const phoneKey = s => { const d = (s || '').replace(/\D/g, ''); return d.length >= 10 ? d.slice(-10) : '' }
const ageOf = s => { const n = parseInt(s, 10); return Number.isFinite(n) && n > 0 && n < 120 ? n : null }

const source = parseCSV(readFileSync(join(dataDir, 'click4appointment_patient_export_2026-10-26.csv'), 'utf8'))
const previous = parseCSV(readFileSync(join(dataDir, 'click4appointment_patient_export_FINAL.csv'), 'utf8'))
const lines = parseCSV(readFileSync(join(dataDir, 'click4appointment_treatments_FINAL.csv'), 'utf8'))

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
const db = await readAll('patients', 'id, full_name, phone, gender, date_of_birth, email, address, import_key, created_at')

// Insertion-order index over the bulk import only.
const importedRank = new Map([...db].filter(p => p.created_at.startsWith('2026-09-12'))
  .sort((a, b) => (a.created_at < b.created_at ? -1 : 1)).map((p, i) => [p.id, i]))
const previousIndex = new Map(previous.map((r, i) => [r['Patient ID'], i]))

const dbByName = new Map(), dbByNamePhone = new Map()
for (const p of db) {
  const n = nameKey(p.full_name), ph = phoneKey(p.phone)
  if (!dbByName.has(n)) dbByName.set(n, [])
  dbByName.get(n).push(p)
  if (ph) {
    const k = `${n}|${ph}`
    if (!dbByNamePhone.has(k)) dbByNamePhone.set(k, [])
    dbByNamePhone.get(k).push(p)
  }
}
const sourceNameCounts = new Map()
for (const r of source) sourceNameCounts.set(nameKey(r['Full Name']), (sourceNameCounts.get(nameKey(r['Full Name'])) || 0) + 1)

const decisions = []
const claimed = new Set()
const counts = {}
const bump = k => { counts[k] = (counts[k] || 0) + 1 }

for (const r of source) {
  const sourceId = r['Patient ID'], n = nameKey(r['Full Name']), ph = phoneKey(r['Phone Number'])
  const srcAge = ageOf(r['Age']), srcGender = (r['Gender'] || '').toLowerCase()
  const candidates = (dbByName.get(n) ?? []).filter(c => !claimed.has(c.id))
  let chosen = null, rule = null

  const namePhone = ph ? (dbByNamePhone.get(`${n}|${ph}`) ?? []).filter(c => !claimed.has(c.id)) : []
  if (namePhone.length === 1) { chosen = namePhone[0]; rule = 'name+phone' }

  if (!chosen && candidates.length === 1 && sourceNameCounts.get(n) === 1) {
    const c = candidates[0], cp = phoneKey(c.phone), cg = (c.gender || '').toLowerCase()
    const phoneConflict = ph && cp && ph !== cp
    const genderConflict = srcGender && cg && srcGender !== cg
    if (!phoneConflict && !genderConflict) { chosen = c; rule = 'name-unique' }
  }

  // (a) same phone as the source
  if (!chosen && ph) {
    const samePhone = candidates.filter(c => phoneKey(c.phone) === ph)
    if (samePhone.length === 1) { chosen = samePhone[0]; rule = 'a: phone match' }
  }

  // (b) gender AND age both present on both sides and agreeing
  if (!chosen && srcAge !== null && srcGender) {
    const agrees = candidates.filter(c => {
      if (!c.date_of_birth || !c.gender) return false
      const appAge = Math.floor((Date.now() - new Date(c.date_of_birth)) / (365.25 * 864e5))
      return c.gender.toLowerCase() === srcGender && Math.abs(appAge - srcAge) <= 1
    })
    if (agrees.length === 1) { chosen = agrees[0]; rule = 'b: gender + age' }
  }

  // (c) insertion order — only for patients that were in the imported export
  if (!chosen && previousIndex.has(sourceId)) {
    const expected = previousIndex.get(sourceId)
    const near = candidates.filter(c => importedRank.has(c.id) && Math.abs(importedRank.get(c.id) - expected) <= 3)
    if (near.length === 1) { chosen = near[0]; rule = 'c: insertion order' }
  }

  if (chosen) { claimed.add(chosen.id); decisions.push({ source_id: sourceId, decision: chosen.id, rule_used: rule }); bump(rule) }
  else { decisions.push({ source_id: sourceId, decision: 'NEW', rule_used: 'd: no safe match' }); bump('d: NEW') }
}

console.log(`\n=== Patient resolution — DRY RUN (nothing written) ===\n`)
console.log(`Source patients: ${source.length}`)
for (const [k, v] of Object.entries(counts).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(4)}  ${k}`)

// ── Backfill plan ───────────────────────────────────────────────────────────
// Only ever fills a field that is empty or the 'N/A' placeholder.
const EMPTY = v => v === null || v === undefined || v === '' || v === 'N/A'
const srcById = new Map(source.map(r => [r['Patient ID'], r]))
const dbById = new Map(db.map(p => [p.id, p]))
const fieldFills = {}
let keysToSet = 0, alreadyKeyed = 0
const parseDate = s => { const m = (s || '').match(/^(\d{2})-(\d{2})-(\d{4})$/); return m ? `${m[3]}-${m[2]}-${m[1]}` : null }

for (const d of decisions) {
  if (d.decision === 'NEW') continue
  const p = dbById.get(d.decision), r = srcById.get(d.source_id)
  if (p.import_key) alreadyKeyed++; else keysToSet++
  const candidateFields = {
    phone: r['Phone Number'] || null,
    gender: r['Gender'] || null,
    email: r['Email'] || null,
    address: r['Address'] || null,
    date_of_birth: parseDate(r['Date of Birth']),
  }
  for (const [field, value] of Object.entries(candidateFields)) {
    if (!value) continue
    if (!EMPTY(p[field])) continue
    fieldFills[field] = (fieldFills[field] || 0) + 1
  }
}
const newCount = decisions.filter(d => d.decision === 'NEW').length
console.log(`\n=== Backfill plan (dry run) ===`)
console.log(`  import_key to set on existing records   ${String(keysToSet).padStart(4)}`)
console.log(`  already carried an import_key           ${String(alreadyKeyed).padStart(4)}`)
console.log(`  new patient records to create           ${String(newCount).padStart(4)}`)
console.log(`  fields filled on existing records (only where empty or 'N/A'):`)
for (const [f, n] of Object.entries(fieldFills).sort((a, b) => b[1] - a[1])) console.log(`    ${String(n).padStart(4)}  ${f}`)
if (!Object.keys(fieldFills).length) console.log(`       0  (nothing to fill)`)
console.log(`  non-empty app values overwritten           0  (never)`)

const cols = ['source_id', 'decision', 'rule_used']
writeFileSync(join(dataDir, 'patient-resolution.csv'),
  [cols.join(','), ...decisions.map(d => cols.map(c => d[c]).join(','))].join('\n') + '\n')
console.log(`\nWrote data/import/patient-resolution.csv (${decisions.length} rows, no names or phone numbers)`)

if (!process.argv.includes('--apply')) {
  console.log(`Nothing written to the database. Re-run with --apply once the counts are approved.\n`)
  process.exit(0)
}

// ── Write ───────────────────────────────────────────────────────────────────
// Direct inserts, not the import_patient() function from migration 016: that
// checks current_staff_role() = 'admin', and the service role has no staff
// row. RLS is bypassed by the service key, so the writes still land.
const KEY_FOR = id => `click4appointment:id:${id}`
const chunk = (rows, n = 500) => Array.from({ length: Math.ceil(rows.length / n) }, (_, i) => rows.slice(i * n, i * n + n))

let keysSet = 0, filled = 0
for (const d of decisions) {
  if (d.decision === 'NEW') continue
  const p = dbById.get(d.decision), r = srcById.get(d.source_id)
  if (p.import_key) continue                                   // already done, idempotent
  const patch = { import_key: KEY_FOR(d.source_id), import_source: r }
  for (const [field, value] of Object.entries({
    phone: r['Phone Number'] || null, gender: r['Gender'] || null, email: r['Email'] || null,
    address: r['Address'] || null, date_of_birth: parseDate(r['Date of Birth']),
  })) {
    if (value && EMPTY(p[field])) { patch[field] = value; filled++ }
  }
  const { error } = await sb.from('patients').update(patch).eq('id', p.id)
  if (error) { console.error(`  update ${d.source_id}: ${error.message}`); continue }
  keysSet++
}
console.log(`\nimport_key set on ${keysSet} existing patients (${filled} empty fields filled).`)

const newRows = decisions.filter(d => d.decision === 'NEW').map(d => {
  const r = srcById.get(d.source_id)
  return {
    import_key: KEY_FOR(d.source_id), import_source: r,
    full_name: r['Full Name'], phone: r['Phone Number'] || null,
    email: r['Email'] || null, gender: r['Gender'] || null, address: r['Address'] || null,
    date_of_birth: parseDate(r['Date of Birth']),
    consent_given: false,                                      // never assumed from an export
  }
})
const existingKeys = new Set(db.filter(p => p.import_key).map(p => p.import_key))
const pending = newRows.filter(r => !existingKeys.has(r.import_key))
const created = []
for (const batch of chunk(pending)) {
  const { data, error } = await sb.from('patients').insert(batch).select('id, import_key')
  if (error) { console.error(`  insert batch: ${error.message}`); break }
  created.push(...data)
}
console.log(`${created.length} new patients created (${pending.length - created.length} failed, ${newRows.length - pending.length} already present).`)

// Medical history for the new patients, where the export carries any.
const medFields = r => ({
  condition: r['Medical History Conditions (selected)'] || r['Medical History Summary'] || null,
  allergies: r['Allergies'] || null,
  current_medications: r['Current Medications'] || null,
  pregnancy_status: /^(yes|true|1)$/i.test(r['Pregnancy Status'] || ''),
})
const idByKey = new Map(created.map(c => [c.import_key, c.id]))
const medRows = []
for (const d of decisions.filter(x => x.decision === 'NEW')) {
  const r = srcById.get(d.source_id), id = idByKey.get(KEY_FOR(d.source_id))
  if (!id) continue
  const m = medFields(r)
  if (m.condition || m.allergies || m.current_medications) medRows.push({ patient_id: id, ...m })
}
let medCount = 0
for (const batch of chunk(medRows)) {
  const { error } = await sb.from('medical_history').insert(batch)
  if (error) { console.error(`  medical_history batch: ${error.message}`); break }
  medCount += batch.length
}
console.log(`${medCount} medical history rows created.`)

const { count: keyed } = await sb.from('patients').select('*', { count: 'exact', head: true }).not('import_key', 'is', null)
const { count: total } = await sb.from('patients').select('*', { count: 'exact', head: true })
console.log(`\nPost-apply check: ${total} patients, ${keyed} carry an import_key (expected ${source.length}).`)
console.log(keyed === source.length ? 'Matches the source export.\n' : 'DOES NOT match the source export — investigate before importing treatments.\n')
