import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { fmtD } from '../lib/format'
import { useToast } from '../components/Toast'
import Modal from '../components/Modal'

export const TAG_OPTIONS = ['VIP', 'Pediatric', 'Anxious patient', 'Needs interpreter', 'Special needs']

export function PatientForm({ patient = {}, onDone, onClose }) {
  const [f, setF] = useState({
    full_name: patient.full_name || '', phone: patient.phone || '', email: patient.email || '',
    date_of_birth: patient.date_of_birth || '', gender: patient.gender || '', address: patient.address || '',
    emergency_contact_name: patient.emergency_contact_name || '', emergency_contact_phone: patient.emergency_contact_phone || '',
    referral_source: patient.referral_source || '', recall_interval_months: patient.recall_interval_months || 6,
    tags: patient.tags || [],
  })
  const toast = useToast()
  const set = k => e => setF(x => ({ ...x, [k]: e.target.value }))
  const toggleTag = t => setF(x => ({ ...x, tags: x.tags.includes(t) ? x.tags.filter(x2 => x2 !== t) : [...x.tags, t] }))

  async function save() {
    if (!f.full_name.trim() || !f.phone.trim()) return toast('Name and phone are required.')
    const rec = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, typeof v === 'string' && !v.trim() ? null : v]))
    rec.recall_interval_months = parseInt(f.recall_interval_months) || 6
    let id = patient.id
    if (id) {
      const { error } = await sb.from('patients').update(rec).eq('id', id)
      if (error) return toast('Error: ' + error.message)
      toast('Patient updated')
    } else {
      rec.consent_given = true; rec.consent_date = new Date().toISOString()
      const { data, error } = await sb.from('patients').insert(rec).select().single()
      if (error) return toast('Error: ' + error.message)
      id = data.id; toast('Patient created')
    }
    onDone(id)
  }

  return (
    <Modal title={(patient.id ? 'Edit' : 'New') + ' patient'} onClose={onClose}>
      <div className="mrow">
        <div><label>Full name *</label><input value={f.full_name} onChange={set('full_name')} /></div>
        <div><label>Phone *</label><input value={f.phone} onChange={set('phone')} /></div>
      </div>
      <div className="mrow">
        <div><label>Email</label><input value={f.email} onChange={set('email')} /></div>
        <div><label>Date of birth</label><input type="date" value={f.date_of_birth || ''} onChange={set('date_of_birth')} /></div>
      </div>
      <div className="mrow">
        <div><label>Gender</label><select value={f.gender} onChange={set('gender')}>
          <option value="">—</option><option>Female</option><option>Male</option><option>Other</option></select></div>
        <div><label>Emergency contact</label><input placeholder="Name" value={f.emergency_contact_name} onChange={set('emergency_contact_name')} /></div>
      </div>
      <div className="mrow">
        <div><label>Emergency phone</label><input value={f.emergency_contact_phone} onChange={set('emergency_contact_phone')} /></div>
        <div></div>
      </div>
      <label>Address</label><textarea rows={2} value={f.address} onChange={set('address')} />
      <div className="mrow">
        <div><label>How did they hear about us?</label>
          <select value={f.referral_source} onChange={set('referral_source')}>
            <option value="">—</option>
            <option>Walk-in</option><option>Google search</option><option>Instagram / Facebook</option>
            <option>Friend / family referral</option><option>Existing patient referral</option>
            <option>Doctor referral</option><option>Other</option>
          </select>
        </div>
        <div><label>Recall interval</label>
          <select value={f.recall_interval_months} onChange={set('recall_interval_months')}>
            <option value="3">Every 3 months (perio maintenance)</option>
            <option value="6">Every 6 months (standard)</option>
            <option value="12">Every 12 months</option>
          </select>
        </div>
      </div>
      <label>Tags</label>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.5rem', marginBottom: '1rem' }}>
        {TAG_OPTIONS.map(t => (
          <label key={t} style={{ display: 'flex', alignItems: 'center', gap: '.35rem', textTransform: 'none', fontSize: '.76rem', color: 'var(--ink)', border: '1px solid var(--rule)', borderRadius: 6, padding: '.3rem .6rem' }}>
            <input type="checkbox" style={{ width: 'auto' }} checked={f.tags.includes(t)} onChange={() => toggleTag(t)} /> {t}
          </label>
        ))}
      </div>
      <button className="btn" onClick={save}>Save patient</button>
    </Modal>
  )
}

export default function Patients() {
  const [rows, setRows] = useState(null)
  const [q, setQ] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const nav = useNavigate()

  async function load() {
    const { data } = await sb.from('patients').select('*').is('merged_into', null).order('created_at', { ascending: false }).limit(500)
    setRows(data ?? [])
  }
  useEffect(() => { load() }, [])

  if (!rows) return <div className="empty">Loading…</div>
  const view = rows.filter(p => !q || (p.full_name || '').toLowerCase().includes(q.toLowerCase()) || (p.phone || '').includes(q))

  return (
    <>
      <div className="pagehead">
        <h2>Patients</h2>
        <div>
          <button className="btn ghost" onClick={() => setShowImport(true)}>Import CSV</button>{' '}
          <button className="btn" onClick={() => setShowForm(true)}>+ New patient</button>
        </div>
      </div>
      <div className="bar"><input placeholder="Search name / phone…" value={q} onChange={e => setQ(e.target.value)} /></div>
      {!view.length ? <div className="empty">No patients yet. Convert a booking or add one.</div> : (
        <table className="tbl">
          <thead><tr><th>Name</th><th>Phone</th><th>DOB</th><th>Registered</th><th></th></tr></thead>
          <tbody>{view.map(p => (
            <tr key={p.id}>
              <td className="link" onClick={() => nav('/patients/' + p.id)}>
                {p.full_name}
                {(p.tags || []).map(t => <span key={t} className="badge b-partial" style={{ marginLeft: '.4rem' }}>{t}</span>)}
              </td>
              <td>{p.phone}</td>
              <td>{fmtD(p.date_of_birth)}</td>
              <td>{fmtD(p.created_at)}</td>
              <td><button className="btn sm ghost" onClick={() => nav('/patients/' + p.id)}>Open</button></td>
            </tr>
          ))}</tbody>
        </table>
      )}
      {showForm && <PatientForm onClose={() => setShowForm(false)} onDone={id => { setShowForm(false); nav('/patients/' + id) }} />}
      {showImport && <ImportForm onClose={() => setShowImport(false)} onDone={() => { setShowImport(false); load() }} />}
    </>
  )
}

// Minimal RFC4180-ish CSV parser (quoted fields, escaped quotes, CRLF/LF) —
// avoids pulling in a parsing dependency for what's a fairly small use case.
function parseCSV(text) {
  const rows = []
  let row = [], field = '', inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i], next = text[i + 1]
    if (inQuotes) {
      if (c === '"' && next === '"') { field += '"'; i++ }
      else if (c === '"') inQuotes = false
      else field += c
    } else if (c === '"') inQuotes = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && next === '\n') i++
      row.push(field); field = ''
      if (row.length > 1 || row[0] !== '') rows.push(row)
      row = []
    } else field += c
  }
  if (field || row.length) { row.push(field); rows.push(row) }
  return rows
}

function ImportForm({ onClose, onDone }) {
  const [fileRows, setFileRows] = useState(null)
  const [fileName, setFileName] = useState('')
  const [busy, setBusy] = useState(false)
  const toast = useToast()

  function handleFile(e) {
    const file = e.target.files[0]
    if (!file) return
    setFileName(file.name)
    const reader = new FileReader()
    reader.onload = () => {
      const rows = parseCSV(String(reader.result))
      if (!rows.length) return toast('Empty file.')
      const headers = rows[0].map(h => h.trim().toLowerCase())
      const missing = ['full_name', 'phone'].filter(r => !headers.includes(r))
      if (missing.length) return toast('Missing required column(s): ' + missing.join(', '))
      const objs = rows.slice(1).filter(r => r.some(c => c.trim())).map(r => {
        const o = {}
        headers.forEach((h, i) => { o[h] = (r[i] || '').trim() })
        return o
      })
      setFileRows(objs)
    }
    reader.readAsText(file)
  }

  async function doImport() {
    if (!fileRows?.length) return
    const recs = fileRows.filter(r => r.full_name && r.phone).map(r => ({
      full_name: r.full_name, phone: r.phone, email: r.email || null,
      date_of_birth: r.date_of_birth || null, gender: r.gender || null, address: r.address || null,
      referral_source: r.referral_source || null,
      consent_given: true, consent_date: new Date().toISOString(),
    }))
    if (!recs.length) return toast('No valid rows (need full_name and phone).')
    setBusy(true)
    const { error } = await sb.from('patients').insert(recs)
    setBusy(false)
    if (error) return toast('Error: ' + error.message)
    toast(`Imported ${recs.length} patient${recs.length === 1 ? '' : 's'}`); onDone()
  }

  return (
    <Modal title="Import patients from CSV" onClose={onClose}>
      <p style={{ fontSize: '.78rem', color: 'var(--mid)', marginBottom: '.75rem' }}>
        Needs a header row with at least <b>full_name</b> and <b>phone</b>. Optional columns: email,
        date_of_birth (YYYY-MM-DD), gender, address, referral_source.
      </p>
      <input type="file" accept=".csv,text/csv" onChange={handleFile} />
      {fileRows && (
        <>
          <p style={{ fontSize: '.78rem', margin: '.75rem 0' }}>{fileRows.length} row(s) found in {fileName}.</p>
          <div style={{ maxHeight: 220, overflowY: 'auto', marginBottom: '.75rem' }}>
            <table className="tbl" style={{ boxShadow: 'none' }}>
              <thead><tr><th>Name</th><th>Phone</th><th>Email</th></tr></thead>
              <tbody>{fileRows.slice(0, 10).map((r, i) => (
                <tr key={i}><td>{r.full_name || '—'}</td><td>{r.phone || '—'}</td><td>{r.email || '—'}</td></tr>
              ))}</tbody>
            </table>
            {fileRows.length > 10 && <p style={{ fontSize: '.68rem', color: 'var(--soft)', padding: '.4rem' }}>+{fileRows.length - 10} more…</p>}
          </div>
          <button className="btn" disabled={busy} onClick={doImport}>{busy ? 'Importing…' : `Import ${fileRows.length} patients`}</button>
        </>
      )}
    </Modal>
  )
}
