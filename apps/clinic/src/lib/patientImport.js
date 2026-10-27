// Target layout for the upload CSV. Column order doesn't matter, headers do.
export const COLUMNS = [
  'source_id', 'full_name', 'phone', 'email', 'date_of_birth', 'gender', 'address',
  'emergency_contact_name', 'emergency_contact_phone', 'consent_given',
  'consent_date', 'referral_source', 'tags', 'medical_conditions',
  'allergies', 'current_medications', 'pregnancy_status',
]

// Accepts either our template's snake_case headers, or the raw
// Click4Appointment export headers, and normalizes both to the same keys.
const HEADER_ALIASES = {
  'patient id': 'source_id',
  'patient_id': 'source_id',
  'source id': 'source_id',
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
  return HEADER_ALIASES[key] || key
}

// Minimal RFC4180 parser — handles quoted fields, escaped quotes, commas/newlines inside quotes.
export function parseCSV(text) {
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
  if (inQuotes) throw new Error('Unclosed quote in CSV.')
  if (!rows.length) return []
  const headers = rows[0].map(normalizeHeader)
  if (!headers.includes('full_name') || !headers.includes('phone')) throw new Error('Required headers: full_name and phone (or Full Name and Phone Number).')
  if (new Set(headers).size !== headers.length) throw new Error('Duplicate column headers.')
  return rows.slice(1).map((r, rowIndex) => {
    if (r.length > headers.length) throw new Error(`Row ${rowIndex + 2} has more fields than headers. Check CSV quoting.`)
    return Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? '').trim()]))
  })
}

export function parseDate(s) {
  if (!s) return null
  const m = s.match(/^(\d{2})[-/](\d{2})[-/](\d{4})$/)
  const iso = m ? `${m[3]}-${m[2]}-${m[1]}` : s
  const d = new Date(iso + 'T12:00:00Z')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso) || !Number.isFinite(d.getTime()) || d.toISOString().slice(0, 10) !== iso) throw new Error(`Invalid date: ${s}`)
  return iso
}
export function parseBool(s) {
  const v = (s || '').trim().toLowerCase()
  if (!v || ['no', 'false', '0'].includes(v)) return false
  if (['yes', 'true', '1'].includes(v)) return true
  throw new Error(`Unrecognized yes/no value: ${s}`)
}

export function buildPatientRow(r) {
  return {
    full_name: r.full_name || '',
    phone: r.phone || null,
    import_source: r,
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

export function hasMedicalData(r) {
  return r.medical_conditions || r.allergies || r.current_medications || r.pregnancy_status || r['medical history summary'] || r['other history (hosp/surgery/chemo)']
}

