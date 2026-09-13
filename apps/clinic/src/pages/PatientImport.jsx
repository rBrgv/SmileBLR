import { useState } from 'react'
import { sb } from '../lib/supabase'
import { useToast } from '../components/Toast'
import { useRole } from '../lib/RoleContext'

// Target layout for the upload CSV. Column order doesn't matter, headers do.
const COLUMNS = [
  'full_name', 'phone', 'email', 'date_of_birth', 'gender', 'address',
  'emergency_contact_name', 'emergency_contact_phone', 'consent_given',
  'consent_date', 'referral_source', 'tags', 'medical_conditions',
  'allergies', 'current_medications', 'pregnancy_status',
]

// Accepts either our template's snake_case headers, or the raw
// Click4Appointment export headers, and normalizes both to the same keys.
const HEADER_ALIASES = {
  'full name': 'full_name',
  'phone number': 'phone',
  'email': 'email',
  'date of birth': 'date_of_birth',
  'gender': 'gender',
  'address': 'address',
  'emergency contact name': 'emergency_contact_name',
  'emergency contact phone': 'emergency_contact_phone',
  'consent given': 'consent_given',
  'consent date': 'consent_date',
  'referral source': 'referral_source',
  'tags / patient category': 'tags',
  'medical history conditions (selected)': 'medical_conditions',
  'allergies': 'allergies',
  'current medications': 'current_medications',
  'pregnancy status': 'pregnancy_status',
}

function normalizeHeader(h) {
  const key = h.trim().toLowerCase()
  return HEADER_ALIASES[key] || h.trim()
}

// Minimal RFC4180 parser — handles quoted fields, escaped quotes, commas/newlines inside quotes.
function parseCSV(text) {
  const rows = []
  let row = [], field = '', inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ } else { inQuotes = false }
      } else field += c
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
  if (!rows.length) return []
  const headers = rows[0].map(normalizeHeader)
  return rows.slice(1).map(r => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? '').trim()])))
}

function parseDate(s) {
  if (!s) return null
  const m = s.match(/^(\d{2})-(\d{2})-(\d{4})$/) // DD-MM-YYYY
  if (m) return `${m[3]}-${m[2]}-${m[1]}`
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  return null
}

function parseBool(s) {
  const v = (s || '').trim().toLowerCase()
  return v === 'yes' || v === 'true' || v === '1'
}

function buildPatientRow(r) {
  return {
    full_name: r.full_name || '',
    phone: r.phone || 'N/A',
    email: r.email || null,
    date_of_birth: parseDate(r.date_of_birth),
    gender: r.gender || null,
    address: r.address || null,
    emergency_contact_name: r.emergency_contact_name || null,
    emergency_contact_phone: r.emergency_contact_phone || null,
    consent_given: parseBool(r.consent_given),
    consent_date: parseDate(r.consent_date),
    referral_source: r.referral_source || null,
    tags: r.tags ? r.tags.split('|').map(t => t.trim()).filter(Boolean) : [],
  }
}

function hasMedicalData(r) {
  return r.medical_conditions || r.allergies || r.current_medications || r.pregnancy_status
}

export default function PatientImport() {
  const [rows, setRows] = useState([])
  const [fileName, setFileName] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const toast = useToast()
  const role = useRole()
  const isAdmin = role === 'admin'

  function onFile(e) {
    const file = e.target.files[0]
    if (!file) return
    setFileName(file.name)
    setResult(null)
    const reader = new FileReader()
    reader.onload = () => setRows(parseCSV(reader.result))
    reader.readAsText(file)
  }

  const skipped = rows.filter(r => !r.full_name?.trim())
  const valid = rows.filter(r => r.full_name?.trim())

  async function runImport() {
    setBusy(true)
    let imported = 0
    const errors = []
    for (const r of valid) {
      const { data, error } = await sb.from('patients').insert(buildPatientRow(r)).select('id').single()
      if (error) { errors.push(`${r.full_name}: ${error.message}`); continue }
      imported++
      if (hasMedicalData(r)) {
        await sb.from('medical_history').insert({
          patient_id: data.id,
          condition: r.medical_conditions || null,
          allergies: r.allergies || null,
          current_medications: r.current_medications || null,
          pregnancy_status: parseBool(r.pregnancy_status),
        })
      }
    }
    setBusy(false)
    setResult({ imported, errors })
    toast(`Imported ${imported} of ${valid.length} patients`)
  }

  if (!isAdmin) return <div className="empty">Only admins can import patients.</div>

  return (
    <>
      <div className="pagehead"><h2>Patient import</h2></div>
      <p style={{ fontSize: '.74rem', color: 'var(--mid)', marginBottom: '1rem' }}>
        Upload a CSV using the template layout below. Required columns: <b>full_name</b>, <b>phone</b>.
        Multiple tags separated with <code>|</code>.
      </p>

      <table className="tbl" style={{ marginBottom: '1rem' }}>
        <thead><tr><th>Column</th><th>Goes to</th></tr></thead>
        <tbody>
          {COLUMNS.map(c => (
            <tr key={c}>
              <td><code>{c}</code></td>
              <td>{c.startsWith('medical') || c === 'allergies' || c === 'current_medications' || c === 'pregnancy_status'
                ? `medical_history.${c === 'medical_conditions' ? 'condition' : c}`
                : `patients.${c}`}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <input type="file" accept=".csv" onChange={onFile} />

      {rows.length > 0 && (
        <div style={{ marginTop: '1rem' }}>
          <p style={{ fontSize: '.8rem' }}>
            <b>{fileName}</b>: {rows.length} rows parsed, {valid.length} ready to import
            {skipped.length > 0 && `, ${skipped.length} skipped (missing name or phone)`}.
          </p>
          <button className="btn sm" disabled={busy || !valid.length} onClick={runImport}>
            {busy ? 'Importing…' : `Import ${valid.length} patients`}
          </button>
        </div>
      )}

      {result && (
        <div style={{ marginTop: '1rem', fontSize: '.8rem' }}>
          <p>Imported: {result.imported}</p>
          {result.errors.length > 0 && (
            <>
              <p style={{ color: 'var(--danger, #c0392b)' }}>Errors ({result.errors.length}):</p>
              <ul>{result.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
            </>
          )}
        </div>
      )}
    </>
  )
}
