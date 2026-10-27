// Click4Appointment treatment-history importer: treatment plans, their
// procedure lines, and the records for lines already carried out.
//
// Run from apps/clinic (where @supabase/supabase-js lives):
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/import-treatments.mjs
//   ...                                          node scripts/import-treatments.mjs --apply
//   node scripts/import-treatments.mjs --offline      # CSV-only report, no database
//
// Dry run is the default; nothing is written without --apply. Requires
// migration 020 (source_key columns + the 'in_progress' stage status).
//
// The service role is required: migration 017's restrictive policies only let
// a doctor or admin write clinical rows, and a script has no staff login.
//
// Patient data never reaches stdout — no names, no phone numbers. Rows that
// cannot be matched are written to data/import/unmatched.csv by source ID.
import { createClient } from '@supabase/supabase-js'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '../../../data/import')
const APPLY = process.argv.includes('--apply')
const OFFLINE = process.argv.includes('--offline')

const URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!OFFLINE && (!URL || !KEY)) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required (or pass --offline)')
  process.exit(1)
}
const sb = OFFLINE ? null : createClient(URL, KEY)

// ── CSV + field parsing ──────────────────────────────────────────────────────
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

function ddmmyyyyToISO(s) {
  const m = (s || '').match(/^(\d{2})-(\d{2})-(\d{4})$/)
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null
}

function stripTags(html) {
  return html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
}

// Blank cost means "unknown" and stays null; a real 0 stays 0.
function parseCost(s) {
  const v = (s || '').replace(/,/g, '').trim()
  if (!v) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

// FDI: quadrants 1-4 carry teeth 1-8, the primary quadrants 5-8 carry 1-5.
function validFDI(n) {
  const q = Math.floor(n / 10), p = n % 10
  return (q >= 1 && q <= 4 && p >= 1 && p <= 8) || (q >= 5 && q <= 8 && p >= 1 && p <= 5)
}

function parseTeeth(s, onInvalid) {
  if (!(s || '').trim()) return []
  return s.split(',').map(t => t.trim()).filter(Boolean).map(t => {
    const n = Number(t)
    if (!Number.isInteger(n) || !validFDI(n)) { onInvalid(t); return null }
    return n
  }).filter(n => n !== null)
}

const norm = s => (s || '').toLowerCase().replace(/\s+/g, ' ').trim()
// Staff names carry punctuation and middle initials the export doesn't:
// "Dr. Prithvi S. Balepur" is the CSV's "Dr PRITHVI BALEPUR".
const nameKey = s => norm(s).replace(/[^a-z0-9 ]/g, ' ').split(/\s+/)
  .filter(w => w && w.length > 1).join(' ')
// Same words in a different order — "COMPOSITE CLASS 2 RESTORATION" against
// the catalogue's "CLASS 2 COMPOSITE RESTORATION".
const tokenKey = s => norm(s).replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean).sort().join(' ')

const STATUS_TO_STAGE = { 'Completed': 'completed', 'In-Progress': 'in_progress', 'Not Started': 'pending' }

// Hand-ruled catalogue decisions (approved 2026-10-26). The stage description
// always keeps the original source wording; only the catalogue link changes.
//   catalogue: use/create this name instead of the source spelling
//   proposal:  a mapping the clinic has not confirmed — link nothing, and
//              write it to catalogue-proposals.csv for them to decide
const CATALOGUE_OVERRIDES = {
  'COMPOSITE CLASS 4 RSETORATION': { catalogue: 'CLASS 4 COMPOSITE RESTORATION' },
  'ZERCONIA CROWN': { catalogue: 'ZIRCONIA' },
  'ZIRCONIA CROWN (15YRS WARRANTY)': { catalogue: 'ZIRCONIA' },
  'PROCEDURE': { proposal: null },
  'Check up': { proposal: 'CONSULTATION' },
  'CAP REMOVAL': { proposal: 'CROWN REMOVAL' },
}

// ── Load the source files ────────────────────────────────────────────────────
const lines = parseCSV(readFileSync(join(dataDir, 'click4appointment_treatments_FINAL.csv'), 'utf8'))
const patientRows = parseCSV(readFileSync(join(dataDir, 'click4appointment_patient_export_2026-10-26.csv'), 'utf8'))
const doctorMap = parseCSV(readFileSync(join(dataDir, 'click4appointment_doctor_id_map.csv'), 'utf8'))

// --patient-map=patient-resolution.csv: use the resolver's decisions instead
// of import_key lookups, so the treatment run can be rehearsed before the
// patient backfill exists. 'NEW' means the backfill will create that patient,
// so the line counts as matched but has no id to write yet.
const MAP_ARG = (process.argv.find(a => a.startsWith('--patient-map=')) || '').split('=')[1]
const resolution = MAP_ARG
  ? new Map(parseCSV(readFileSync(join(dataDir, MAP_ARG), 'utf8')).map(r => [r.source_id, r.decision]))
  : null

const sourceIdByInternal = new Map(patientRows.map(p => [p['Internal System ID'], p['Patient ID']]))
const knownSourceIds = new Set(patientRows.map(p => p['Patient ID']))
const doctorNameById = new Map(doctorMap.map(d => [d['Procedure Doctor ID'], d['Doctor Name']]))

const report = {
  lines: lines.length,
  plans: new Set(lines.map(l => l['Internal Plan ID'])).size,
  matchedLines: 0,
  notYetImportedPatients: new Set(),
  unmatchedLines: [],
  statusBreakdown: {},
  invalidTeeth: [],
  blankCost: 0,
  zeroCost: 0,
  costByStatus: {},
  notes: [],
}

// ── Resolve the patient for every line ───────────────────────────────────────
async function loadPatientsByImportKey() {
  const byKey = new Map(), byInternal = new Map()
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('patients').select('id, import_key, import_source')
      .not('import_key', 'is', null).range(from, from + 999)
    if (error) throw new Error(`Reading patients: ${error.message}`)
    for (const p of data) {
      byKey.set(p.import_key, p.id)
      const internal = p.import_source?.['internal system id']
      if (internal) byInternal.set(String(internal), p.id)
    }
    if (data.length < 1000) break
  }
  return { byKey, byInternal }
}

// ── Catalogue, staff ─────────────────────────────────────────────────────────
async function loadTable(table, columns) {
  const { data, error } = await sb.from(table).select(columns)
  if (error) throw new Error(`Reading ${table}: ${error.message}`)
  return data
}

async function main() {
  let patients = { byKey: new Map(), byInternal: new Map() }
  let treatments = [], staff = []
  if (!OFFLINE) {
    patients = await loadPatientsByImportKey()
    treatments = await loadTable('treatments', 'id, name')
    staff = await loadTable('staff', 'id, full_name, role, active')
  }
  const treatmentByName = new Map(treatments.map(t => [norm(t.name), t]))
  const treatmentByTokens = new Map(treatments.map(t => [tokenKey(t.name), t]))
  const staffByName = new Map(staff.map(s => [norm(s.full_name), s]))
  // Build the looser index only where it stays unambiguous.
  const staffByKey = new Map(), keyCounts = new Map()
  for (const s of staff) keyCounts.set(nameKey(s.full_name), (keyCounts.get(nameKey(s.full_name)) || 0) + 1)
  for (const s of staff) if (keyCounts.get(nameKey(s.full_name)) === 1) staffByKey.set(nameKey(s.full_name), s)
  const ambiguousStaff = [...keyCounts].filter(([, n]) => n > 1).map(([k]) => k)
  const findStaff = name => staffByName.get(norm(name || '')) ?? staffByKey.get(nameKey(name || '')) ?? null

  // Group the flat CSV into plans.
  const plans = new Map()
  for (const [i, l] of lines.entries()) {
    const planId = l['Internal Plan ID']
    const sourceId = l['Patient ID'] || sourceIdByInternal.get(l['Internal Patient ID']) || ''
    const inExport = Boolean(sourceId) && knownSourceIds.has(sourceId)
    // The app's patients came from an earlier, smaller export, so a patient can
    // be in this CSV and still have no row to attach treatment history to.
    const resolved = resolution?.get(sourceId) ?? null
    const patientId = resolution
      ? (resolved && resolved !== 'NEW' ? resolved : null)
      : OFFLINE || !inExport ? null
        : patients.byKey.get(`click4appointment:id:${sourceId}`) ?? patients.byInternal.get(l['Internal Patient ID']) ?? null
    const matched = resolution
      ? Boolean(resolved)                       // 'NEW' counts: the backfill creates it
      : inExport && (OFFLINE || Boolean(patientId))
    report.statusBreakdown[l['Procedure Status'] || '(blank)'] = (report.statusBreakdown[l['Procedure Status'] || '(blank)'] || 0) + 1
    const cost = parseCost(l['Cost'])
    if (l['Cost'].trim() === '') report.blankCost++
    else if (cost === 0) report.zeroCost++
    const bucket = l['Procedure Status'] || '(blank)'
    report.costByStatus[bucket] = (report.costByStatus[bucket] || 0) + (cost || 0)

    if (!matched) {
      report.unmatchedLines.push({
        plan_no: l['Treatment Plan No'], internal_plan_id: planId, line_no: l['Line No'],
        internal_patient_id: l['Internal Patient ID'], procedure: l['Procedure'],
        procedure_date: l['Procedure Date'], status: l['Procedure Status'],
        reason: !inExport
          ? (sourceId ? 'Patient ID not in patient export' : 'No Patient ID and Internal Patient ID not in patient export')
          : resolution ? 'Not present in the patient resolution file'
          : 'Patient is in the export but has no record in the app yet — re-run the patient import',
      })
      if (inExport) report.notYetImportedPatients.add(sourceId)
      continue
    }
    report.matchedLines++

    if (!plans.has(planId)) {
      plans.set(planId, {
        source_key: `click4appointment:plan:${planId}`,
        sourceId,
        patientId,
        plan_no: l['Treatment Plan No'],
        plan_date: ddmmyyyyToISO(l['Plan Date']),
        plan_doctor: l['Plan Doctor'],
        description: stripTags(l['Plan Notes'] || ''),
        lines: [],
      })
    }
    const teeth = parseTeeth(l['Teeth'], t => report.invalidTeeth.push({ row: i + 2, value: t }))
    plans.get(planId).lines.push({
      source_key: `click4appointment:line:${planId}:${l['Line No']}`,
      line_no: Number(l['Line No']) || null,
      procedure: l['Procedure'],
      cost,
      teeth,
      doctor_id_raw: l['Procedure Doctor'],
      procedure_date: ddmmyyyyToISO(l['Procedure Date']),
      status: STATUS_TO_STAGE[l['Procedure Status']] ?? 'pending',
      raw_status: l['Procedure Status'],
      notes: l['Procedure Notes'] || null,
    })
  }

  // ── Catalogue match report ────────────────────────────────────────────────
  // Counted over every source line, not just the matched ones, so the
  // catalogue can be reviewed before patient matching is sorted out.
  const procedureCounts = new Map()
  for (const l of lines) {
    const name = l['Procedure']
    if (!name) continue
    procedureCounts.set(name, (procedureCounts.get(name) || 0) + 1)
  }
  const catalogue = [...procedureCounts.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => {
    const override = CATALOGUE_OVERRIDES[name]
    if (override && 'proposal' in override) {
      return { name, count, match: 'unlinked', catalogue_name: null, proposal: override.proposal }
    }
    const target = override?.catalogue ?? name
    const exact = treatmentByName.get(norm(target))
    const reordered = exact ? null : treatmentByTokens.get(tokenKey(target))
    const hit = exact ?? reordered
    return {
      name, count, target,
      match: override ? (hit ? 'override -> existing' : 'override -> create corrected')
        : exact ? 'exact' : reordered ? 'same words, different order' : 'new',
      catalogue_name: hit?.name ?? (override ? target : null),
    }
  })

  // ── Doctor match report ───────────────────────────────────────────────────
  const doctorIds = new Set()
  for (const l of lines) if (l['Procedure Doctor']) doctorIds.add(l['Procedure Doctor'])
  const doctors = [...doctorIds].sort().map(id => {
    const name = doctorNameById.get(id)
    const match = name ? findStaff(name) : null
    return { id, name: name ?? '(not in doctor ID map)',
      staff: match ? `${match.active ? 'matched' : 'matched but INACTIVE'} -> ${match.full_name}` : 'NO STAFF ROW' }
  })
  const unusedMapRows = doctorMap.filter(d => !doctorIds.has(d['Procedure Doctor ID'])).map(d => d['Doctor Name'])

  // ── Row counts that would be written ──────────────────────────────────────
  let stageCount = 0, recordCount = 0, completedLines = 0, multiToothLines = 0, recordsWithoutTooth = 0
  for (const p of plans.values()) for (const l of p.lines) {
    stageCount++
    if (l.status !== 'completed') continue
    completedLines++
    if (l.teeth.length > 1) multiToothLines++
    if (l.teeth.length === 0) recordsWithoutTooth++
    recordCount += Math.max(1, l.teeth.length)
  }

  // ── Print ─────────────────────────────────────────────────────────────────
  const inr = n => '₹' + Math.round(n).toLocaleString('en-IN')
  console.log(`\n=== Click4Appointment treatment import — ${APPLY ? 'APPLY' : OFFLINE ? 'DRY RUN (offline, no database)' : 'DRY RUN'} ===\n`)
  console.log(`Source lines           ${report.lines}`)
  console.log(`Source plans           ${report.plans}`)
  console.log(`Lines matched          ${report.matchedLines}`)
  console.log(`Lines unmatched        ${report.unmatchedLines.length}  -> data/import/unmatched.csv`)
  if (report.notYetImportedPatients.size)
    console.log(`  of which, patients in the export but not yet in the app: ${report.notYetImportedPatients.size} patients`)
  console.log(`Plans to import        ${plans.size}`)
  if (resolution) {
    const pending = [...plans.values()].filter(p => !p.patientId).length
    console.log(`  plans whose patient the backfill still has to create: ${pending}`)
  }
  console.log(`\nWould write:`)
  console.log(`  treatment_plans        ${plans.size}`)
  console.log(`  treatment_plan_stages  ${stageCount}`)
  console.log(`  treatment_records      ${recordCount}   (from ${completedLines} completed lines: ${multiToothLines} are multi-tooth and expand, ${recordsWithoutTooth} record no tooth)`)
  console.log(`\nProcedure status breakdown (all source lines):`)
  for (const [k, v] of Object.entries(report.statusBreakdown)) console.log(`  ${k.padEnd(14)} ${String(v).padStart(5)}   cost ${inr(report.costByStatus[k] || 0)}`)
  console.log(`\nCost: ${report.blankCost} blank (kept null), ${report.zeroCost} genuine zeros, total ${inr(Object.values(report.costByStatus).reduce((a, b) => a + b, 0))}`)
  console.log(`Teeth: ${report.invalidTeeth.length} invalid FDI values`)

  console.log(`\n=== Procedure catalogue (${catalogue.length} distinct names) ===`)
  if (OFFLINE) {
    console.log('  Catalogue matching needs the database; offline mode only lists the source names.')
    for (const c of catalogue) console.log(`    ${String(c.count).padStart(4)}x  ${c.name}`)
  } else {
  const news = catalogue.filter(c => c.match === 'new')
  const reorder = catalogue.filter(c => c.match === 'same words, different order')
  const exact = catalogue.filter(c => c.match === 'exact')
  const overrides = catalogue.filter(c => c.match.startsWith('override'))
  const unlinked = catalogue.filter(c => c.match === 'unlinked')
  console.log(`  exact: ${exact.length} | reordered: ${reorder.length} | overridden: ${overrides.length} | unlinked: ${unlinked.length} | to create: ${news.length + overrides.filter(c => c.match === 'override -> create corrected').length}`)
  if (overrides.length) {
    console.log(`\n  Approved overrides (stage description keeps the source wording):`)
    for (const c of overrides) console.log(`    ${String(c.count).padStart(4)}x  ${c.name}  ->  ${c.catalogue_name}${c.match.endsWith('corrected') ? '   (created, corrected spelling)' : ''}`)
  }
  if (unlinked.length) {
    console.log(`\n  Left unlinked — no treatment_id, description only:`)
    for (const c of unlinked) console.log(`    ${String(c.count).padStart(4)}x  ${c.name}${c.proposal ? `   proposed: ${c.proposal} (unconfirmed)` : ''}`)
  }
  if (reorder.length) {
    console.log(`\n  Same words, different order — reuse the catalogue entry instead of creating a duplicate:`)
    for (const c of reorder) console.log(`    ${String(c.count).padStart(4)}x  ${c.name}  ->  ${c.catalogue_name}`)
  }
  if (news.length) {
    console.log(`\n  Would be created as new catalogue entries:`)
    for (const c of news) console.log(`    ${String(c.count).padStart(4)}x  ${c.name}`)
  }
  if (exact.length) {
    console.log(`\n  Already in the catalogue:`)
    for (const c of exact) console.log(`    ${String(c.count).padStart(4)}x  ${c.name}`)
  }
  }

  console.log(`\n=== Procedure doctors ===`)
  for (const d of doctors) console.log(`  ${d.id}  ${d.name.padEnd(22)} ${OFFLINE ? '(staff matching needs the database)' : d.staff}`)
  if (unusedMapRows.length) console.log(`  Unused map rows (no line references them): ${unusedMapRows.join(', ')}`)
  if (ambiguousStaff.length) console.log(`  Staff names that collapse to the same key (never matched loosely): ${ambiguousStaff.join(', ')}`)
  const planDoctors = [...new Set(lines.map(l => l['Plan Doctor']).filter(Boolean))].sort()
  console.log(`\n=== Plan doctors (treatment_plans.created_by) ===`)
  for (const d of planDoctors) {
    const m = findStaff(d)
    console.log(`  ${d.padEnd(22)} ${m ? `matched -> ${m.full_name}` : 'NO STAFF ROW'}`)
  }

  // Proposed catalogue mappings the clinic has not confirmed.
  const proposals = catalogue.filter(c => c.match === 'unlinked')
  const proposalCsv = ['source_procedure,lines_affected,proposed_catalogue_entry,status',
    ...proposals.map(c => `"${c.name}",${c.count},"${c.proposal ?? ''}",unconfirmed - not applied`)].join('\n')
  writeFileSync(join(dataDir, 'catalogue-proposals.csv'), proposalCsv + '\n')
  console.log(`\nWrote data/import/catalogue-proposals.csv (${proposals.length} unconfirmed mappings for the clinic)`)

  // unmatched.csv — source identifiers only, no names or phone numbers.
  const cols = ['plan_no', 'internal_plan_id', 'line_no', 'internal_patient_id', 'procedure', 'procedure_date', 'status', 'reason']
  const csv = [cols.join(','), ...report.unmatchedLines.map(r => cols.map(c => {
    const v = String(r[c] ?? '')
    return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
  }).join(','))].join('\n')
  writeFileSync(join(dataDir, 'unmatched.csv'), csv + '\n')
  console.log(`\nWrote data/import/unmatched.csv (${report.unmatchedLines.length} rows, no names or phone numbers)`)

  if (!APPLY) {
    console.log(`\nNothing written to the database. Re-run with --apply once the counts look right.\n`)
    return
  }

  // ── Write ─────────────────────────────────────────────────────────────────
  // --patient-map is a rehearsal aid: 'NEW' patients have no id yet, and
  // treatment_plans.patient_id is nullable, so writing through the map would
  // silently create plans attached to nobody. Run the patient backfill first;
  // afterwards the normal import_key lookup resolves everyone.
  if (resolution) {
    console.error('\nRefusing to write: --patient-map is a rehearsal aid. Run the patient backfill first, then re-run without the map.\n')
    process.exit(1)
  }
  const orphans = [...plans.values()].filter(p => !p.patientId)
  if (orphans.length) {
    console.error(`\nRefusing to write: ${orphans.length} plans have no patient id.\n`)
    process.exit(1)
  }
  // Idempotence is by explicit lookup of source_key rather than upsert: the
  // unique indexes from migration 020 are partial, which ON CONFLICT cannot
  // infer, and skipping rows that already exist never rewrites staff edits.
  async function insertChunks(table, rows, columns) {
    const out = []
    for (let i = 0; i < rows.length; i += 500) {
      const { data, error } = await sb.from(table).insert(rows.slice(i, i + 500)).select(columns)
      if (error) throw new Error(`Inserting ${table}: ${error.message}`)
      out.push(...data)
    }
    return out
  }

  async function existingKeys(table) {
    const keys = new Map()
    for (let from = 0; ; from += 1000) {
      const { data, error } = await sb.from(table).select('id, source_key').not('source_key', 'is', null).range(from, from + 999)
      if (error) throw new Error(`Reading ${table}: ${error.message}`)
      for (const r of data) keys.set(r.source_key, r.id)
      if (data.length < 1000) break
    }
    return keys
  }

  // Catalogue: reuse an exact or reordered match, create the rest once.
  const treatmentIdFor = new Map()
  const toCreate = new Set()
  for (const c of catalogue) {
    if (c.match === 'unlinked') continue            // description only, no link
    const hit = treatmentByName.get(norm(c.target)) ?? treatmentByTokens.get(tokenKey(c.target))
    if (hit) treatmentIdFor.set(c.name, hit.id)
    else toCreate.add(c.target)
  }
  if (toCreate.size) {
    const created = await insertChunks('treatments', [...toCreate].map(name => ({ name })), 'id, name')
    const byName = new Map(created.map(t => [norm(t.name), t.id]))
    for (const c of catalogue) {
      if (c.match === 'unlinked' || treatmentIdFor.has(c.name)) continue
      treatmentIdFor.set(c.name, byName.get(norm(c.target)) ?? null)
    }
    console.log(`Created ${created.length} catalogue entries.`)
  }

  const staffIdFor = name => findStaff(name)?.id ?? null
  const planKeys = await existingKeys('treatment_plans')
  const planRows = [...plans.values()].filter(p => !planKeys.has(p.source_key)).map(p => {
    const costs = p.lines.map(l => l.cost).filter(c => c !== null)
    const statuses = new Set(p.lines.map(l => l.status))
    return {
      source_key: p.source_key,
      patient_id: p.patientId,
      plan_description: p.description || null,
      total_estimated_cost: costs.length ? costs.reduce((a, b) => a + b, 0) : null,
      status: statuses.size === 1 && statuses.has('completed') ? 'completed'
        : statuses.has('completed') || statuses.has('in_progress') ? 'in_progress' : 'proposed',
      created_by: staffIdFor(p.plan_doctor),
      // The source plan date is the only date this table can carry.
      created_at: p.plan_date ? `${p.plan_date}T00:00:00+05:30` : undefined,
    }
  })
  const insertedPlans = await insertChunks('treatment_plans', planRows, 'id, source_key')
  for (const r of insertedPlans) planKeys.set(r.source_key, r.id)
  console.log(`treatment_plans: ${insertedPlans.length} inserted, ${plans.size - insertedPlans.length} already present.`)

  const stageKeys = await existingKeys('treatment_plan_stages')
  const stageRows = []
  for (const p of plans.values()) for (const l of p.lines) {
    if (stageKeys.has(l.source_key)) continue
    stageRows.push({
      source_key: l.source_key,
      plan_id: planKeys.get(p.source_key),
      stage_number: l.line_no,
      description: l.procedure || null,
      estimated_cost: l.cost,
      status: l.status,
    })
  }
  const insertedStages = await insertChunks('treatment_plan_stages', stageRows, 'id, source_key')
  for (const r of insertedStages) stageKeys.set(r.source_key, r.id)
  console.log(`treatment_plan_stages: ${insertedStages.length} inserted, ${stageCount - insertedStages.length} already present.`)

  const recordKeys = await existingKeys('treatment_records')
  const recordRows = []
  for (const p of plans.values()) for (const l of p.lines) {
    if (l.status !== 'completed') continue
    const teeth = l.teeth.length ? l.teeth : [null]
    for (const tooth of teeth) {
      const key = `${l.source_key}:tooth:${tooth ?? 'none'}`
      if (recordKeys.has(key)) continue
      recordRows.push({
        source_key: key,
        patient_id: p.patientId,
        stage_id: stageKeys.get(l.source_key),
        treatment_id: treatmentIdFor.get(l.procedure) ?? null,
        tooth_number: tooth,
        performed_by: staffIdFor(doctorNameById.get(l.doctor_id_raw)),
        performed_date: l.procedure_date,
        notes: l.notes,
        follow_up_required: false,
      })
    }
  }
  const insertedRecords = await insertChunks('treatment_records', recordRows, 'id, source_key')
  console.log(`treatment_records: ${insertedRecords.length} inserted, ${recordCount - insertedRecords.length} already present.`)

  // ── Post-apply check: database totals against the CSV ─────────────────────
  const imported = async (table, columns = 'id') => {
    const out = []
    for (let from = 0; ; from += 1000) {
      const { data, error } = await sb.from(table).select(columns).not('source_key', 'is', null).range(from, from + 999)
      if (error) throw new Error(`Verifying ${table}: ${error.message}`)
      out.push(...data)
      if (data.length < 1000) break
    }
    return out
  }
  const dbPlans = await imported('treatment_plans')
  const dbStages = await imported('treatment_plan_stages', 'status, estimated_cost')
  const dbRecords = await imported('treatment_records')
  const { count: keyedPatients } = await sb.from('patients').select('*', { count: 'exact', head: true }).not('import_key', 'is', null)

  const expectedCost = {}
  for (const p of plans.values()) for (const l of p.lines) expectedCost[l.status] = (expectedCost[l.status] || 0) + (l.cost || 0)
  const dbCost = {}
  for (const st of dbStages) dbCost[st.status] = (dbCost[st.status] || 0) + Number(st.estimated_cost || 0)

  const line = (label, db, csv) => console.log(`  ${label.padEnd(24)} db ${String(db).padStart(8)}   csv ${String(csv).padStart(8)}   ${db === csv ? 'ok' : 'MISMATCH'}`)
  console.log(`\n=== Post-apply check ===`)
  line('patients with import_key', keyedPatients, 916)
  line('treatment_plans', dbPlans.length, plans.size)
  line('treatment_plan_stages', dbStages.length, stageCount)
  line('treatment_records', dbRecords.length, recordCount)
  console.log(`  cost by stage status:`)
  for (const st of ['completed', 'in_progress', 'pending']) {
    line(`    ${st}`, Math.round(dbCost[st] || 0), Math.round(expectedCost[st] || 0))
  }
  console.log('\nDone. Re-running is safe: existing source keys are skipped.\n')
}

main().catch(e => { console.error(e.message); process.exit(1) })
