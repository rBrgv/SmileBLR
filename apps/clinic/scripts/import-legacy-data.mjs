// One-time legacy-data importer for the Click4Appointment → SmileBLR
// migration. Imports invoices.csv and appointments_history.csv into the
// `invoices` and `appointments` tables.
//
// Run: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/import-legacy-data.mjs
//
// Patient matching: by phone (last 10 digits) when available, else by
// case-insensitive full-name match. A single unambiguous match is used;
// zero matches auto-creates a minimal patient record (name + phone, or
// phone 'N/A' if none — same placeholder convention as the earlier CSV
// import); more than one match is skipped and reported rather than guessed.
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '../../../scripts/data')

const URL = process.env.SUPABASE_URL
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
  const headers = rows[0].map(h => h.trim())
  return rows.slice(1).map(r => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? '').trim()])))
}

function ddmmyyyyToISO(s) {
  const m = s.match(/^(\d{2})-(\d{2})-(\d{4})$/)
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null
}

function stripTags(html) {
  return html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
}

const patientCache = new Map() // key -> { id, created }
async function resolvePatient({ name, phone }, report) {
  const cacheKey = (phone || '') + '|' + name.toLowerCase()
  if (patientCache.has(cacheKey)) return patientCache.get(cacheKey)

  let matches = []
  if (phone) {
    const last10 = phone.replace(/\D/g, '').slice(-10)
    const { data } = await sb.from('patients').select('id, full_name, phone').ilike('phone', `%${last10}`)
    matches = data ?? []
  }
  if (!matches.length) {
    const { data } = await sb.from('patients').select('id, full_name, phone').ilike('full_name', name)
    matches = data ?? []
  }

  if (matches.length === 1) {
    const result = { id: matches[0].id, created: false }
    patientCache.set(cacheKey, result)
    return result
  }
  if (matches.length > 1) {
    report.ambiguousPatients.push({ name, phone })
    patientCache.set(cacheKey, null)
    return null
  }
  const { data: created, error } = await sb.from('patients').insert({ full_name: name, phone: phone || 'N/A' }).select('id').single()
  if (error) { report.errors.push(`Creating patient "${name}": ${error.message}`); return null }
  const result = { id: created.id, created: true }
  patientCache.set(cacheKey, result)
  report.createdPatients.push(name)
  return result
}

const doctorCache = new Map()
async function resolveDoctor(name) {
  if (!name) return null
  const key = name.toLowerCase()
  if (doctorCache.has(key)) return doctorCache.get(key)
  const { data } = await sb.from('staff').select('id, full_name').eq('role', 'doctor').ilike('full_name', `%${name}%`).limit(1).maybeSingle()
  doctorCache.set(key, data?.id ?? null)
  return data?.id ?? null
}

async function importInvoices(report) {
  const rows = parseCSV(readFileSync(join(dataDir, 'invoices.csv'), 'utf8'))
    .filter(r => r['Sr. No'] && r['Sr. No'] !== '-')

  const groups = new Map()
  for (const r of rows) {
    const id = r['Inv ID']
    if (!groups.has(id)) groups.set(id, [])
    groups.get(id).push(r)
  }

  for (const [invId, items] of groups) {
    const patientName = items[0]['Patient'].trim()
    const date = ddmmyyyyToISO(items[0]['Date'])
    const patient = await resolvePatient({ name: patientName, phone: null }, report)
    if (!patient) { report.skippedInvoices.push(invId); continue }

    const amount = items.reduce((sum, r) => sum + (parseFloat((r['Amount After Tax'] || '0').replace(/,/g, '')) || 0), 0)
    const notes = items.map(r => `${r['Service/Procedure']} (${r['Doctor']}) - ₹${r['Amount After Tax']}`).join('; ')

    const { error } = await sb.from('invoices').insert({
      patient_id: patient.id, amount, payment_status: 'paid', invoice_date: date, notes: `Imported from Click4Appointment ${invId}: ${notes}`,
    })
    if (error) report.errors.push(`Invoice ${invId}: ${error.message}`)
    else report.invoicesInserted++
  }
}

async function importAppointments(report) {
  const rows = parseCSV(readFileSync(join(dataDir, 'appointments_history.csv'), 'utf8'))

  for (const r of rows) {
    const nameMatch = r['Patient Name'].match(/>([^<]+)<br>\(([^)]+)\)/)
    if (!nameMatch) { report.errors.push('Could not parse Patient Name: ' + r['Patient Name']); continue }
    const patientName = nameMatch[1].trim()
    const phoneMatch = nameMatch[2].match(/(\d{6,})/)
    const phone = phoneMatch ? phoneMatch[1] : null

    const doctorMatch = stripTags(r['Doctor']).match(/^(.*?)\s+Booked On/)
    const doctorName = doctorMatch ? doctorMatch[1].trim() : stripTags(r['Doctor'])
    const doctorId = await resolveDoctor(doctorName)
    if (!doctorId) report.unmatchedDoctors.push(doctorName)

    const date = ddmmyyyyToISO(r['Appointment Date'])
    const timeMatch = r['Time'].match(/^(\d{1,2}):(\d{2})\s*(AM|PM)\s*-\s*(\d{1,2}):(\d{2})\s*(AM|PM)/)
    if (!date || !timeMatch) { report.errors.push('Could not parse date/time: ' + r['Appointment Date'] + ' ' + r['Time']); continue }
    const to24 = (h, m, ap) => { let hh = parseInt(h) % 12; if (ap === 'PM') hh += 12; return hh * 60 + parseInt(m) }
    const startMin = to24(timeMatch[1], timeMatch[2], timeMatch[3])
    const endMin = to24(timeMatch[4], timeMatch[5], timeMatch[6])
    const duration = endMin > startMin ? endMin - startMin : 30
    const appointmentTime = new Date(`${date}T00:00:00`)
    appointmentTime.setMinutes(startMin)

    const statusText = stripTags(r['Status'])
    const status = /complete/i.test(statusText) ? 'completed' : /cancel/i.test(statusText) ? 'cancelled' : 'scheduled'

    const patient = await resolvePatient({ name: patientName, phone }, report)
    if (!patient) { report.skippedAppointments.push(patientName); continue }

    const { error } = await sb.from('appointments').insert({
      patient_id: patient.id, doctor_id: doctorId, appointment_time: appointmentTime.toISOString(),
      duration_minutes: duration, status, notes: r['Reason'] ? `Imported: ${r['Reason']}` : 'Imported from Click4Appointment',
    })
    if (error) report.errors.push(`Appointment for ${patientName}: ${error.message}`)
    else report.appointmentsInserted++
  }
}

const report = {
  invoicesInserted: 0, appointmentsInserted: 0,
  createdPatients: [], ambiguousPatients: [], skippedInvoices: [], skippedAppointments: [],
  unmatchedDoctors: [], errors: [],
}

await importInvoices(report)
await importAppointments(report)

console.log(JSON.stringify(report, null, 2))
