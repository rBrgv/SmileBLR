import { useState, useRef } from 'react'
import { sb } from '../lib/supabase'
import { useToast } from '../components/Toast'
import { useRole } from '../lib/RoleContext'

import { COLUMNS, parseCSV, parseBool, buildPatientRow, hasMedicalData } from '../lib/patientImport'

export default function PatientImport() {
  const [rows, setRows] = useState([])
  const [fileName, setFileName] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const toast = useToast()
  const role = useRole()
  const isAdmin = role === 'admin'

  const lock = useRef(false)
  function onFile(e) {
    const file = e.target.files[0]
    setRows([]); setResult(null)
    if (!file) return
    setFileName(file.name)
    const reader = new FileReader()
    reader.onload = () => { try { setRows(parseCSV(String(reader.result))) } catch (e) { toast(e.message) } }
    reader.onerror = () => toast('Could not read CSV.')
    reader.readAsText(file)
  }
  const valid = rows.filter(r => r.full_name?.trim() && (r.phone?.trim() || r.source_id?.trim()))
  const skipped = rows.filter(r => !r.full_name?.trim() || (!r.phone?.trim() && !r.source_id?.trim()))
  async function runImport() {
    if (lock.current) return
    lock.current = true; setBusy(true)
    let imported = 0, already = 0
    const errors = []
    try {
      for (const [index, r] of rows.entries()) {
        try {
          if (!r.full_name?.trim() || (!r.phone?.trim() && !r.source_id?.trim())) throw new Error('Name and either phone or source_id required')
          const patient = buildPatientRow(r)
          const medical = hasMedicalData(r) ? { condition: r.medical_conditions || null, allergies: r.allergies || null, current_medications: r.current_medications || null, pregnancy_status: r.pregnancy_status ? parseBool(r.pregnancy_status) : null, notes: [r['medical history summary'], r['other history (hosp/surgery/chemo)']].filter(Boolean).join('\n') || null } : null
          const fingerprint = JSON.stringify([patient, medical])
          const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(fingerprint)))).map(b => b.toString(16).padStart(2, '0')).join('')
          const key = 'click4appointment:' + (r.source_id ? 'id:' + r.source_id : 'row:' + hash)
          const { data, error } = await sb.rpc('import_patient', { p_key: key, p_patient: patient, p_medical: medical })
          if (error) throw error
          if (data.status === 'already_imported') already++; else imported++
        } catch (e) { errors.push(`Row ${index + 2} (${r.full_name || 'unnamed'}): ${e.message}`) }
      }
      setResult({ imported, already, errors })
      toast(`${imported} imported; ${already} already imported; ${errors.length} failed`)
    } finally { lock.current = false; setBusy(false) }
  }

  if (!isAdmin) return <div className="empty">Only admins can import patients.</div>

  return (
    <>
      <div className="pagehead"><h2>Patient import</h2></div>
      <p style={{ fontSize: '.74rem', color: 'var(--mid)', marginBottom: '1rem' }}>
        Upload a CSV using the template layout below. Required: <b>full_name</b> and either <b>phone</b> or <b>source_id</b> per patient. Include the phone column even when blank.
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

      <p>Use the original patient ID as <code>source_id</code> when available. Re-uploading the same source ID skips it; changed existing records require review. This imports demographics and medical history, not appointments, treatments or balances.</p>
      <input type="file" accept=".csv" disabled={busy} onChange={onFile} />

      {rows.length > 0 && (
        <div style={{ marginTop: '1rem' }}>
          <p style={{ fontSize: '.8rem' }}>
            <b>{fileName}</b>: {rows.length} rows parsed, {valid.length} ready to import
            {skipped.length > 0 && `, ${skipped.length} invalid (missing name or both phone and source ID)`}.
          </p>
          <button className="btn sm" disabled={busy || !valid.length} onClick={runImport}>
            {busy ? 'Importing…' : `Import ${valid.length} patients`}
          </button>
        </div>
      )}

      {result && (
        <div style={{ marginTop: '1rem', fontSize: '.8rem' }}>
          <p>Imported: {result.imported} · Already imported: {result.already} · Failed: {result.errors.length}</p>
          <button className="btn ghost" onClick={() => { const url = URL.createObjectURL(new Blob([JSON.stringify({ fileName, ...result }, null, 2)], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = 'import-report.json'; a.click(); URL.revokeObjectURL(url) }}>Download import report</button>
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
