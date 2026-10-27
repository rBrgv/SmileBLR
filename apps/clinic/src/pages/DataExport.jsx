import { fetchAll } from '../lib/handoff'
import { useState, useRef } from 'react'
import { sb } from '../lib/supabase'
import { today } from '../lib/format'
import { useToast } from '../components/Toast'
import { useRole } from '../lib/RoleContext'

const TABLES = ['consultations', 'consultation_amendments', 'consent_templates', 'patients', 'medical_history', 'appointments', 'appointment_waitlist', 'invoices', 'invoice_payment_changes', 'treatment_plans', 'treatment_plan_stages', 'treatment_records', 'prescriptions', 'tooth_chart', 'periodontal_exams', 'periodontal_readings', 'xray_images', 'patient_documents', 'consent_forms', 'recall_reminders', 'lab_orders', 'referrals', 'insurance_claims', 'inventory', 'staff', 'staff_leave', 'treatments', 'plan_templates', 'plan_template_stages', 'compliance_logs', 'activity_log', 'bookings', 'clinic_settings', 'campaigns', 'campaign_sends', 'wa_conversations', 'wa_messages'].map(key => ({ key, label: key.replaceAll('_', ' '), select: '*' }))


// Flattens one level of nested relation objects (e.g. patients: {full_name}
// becomes patients_full_name) so the CSV stays a plain flat table.
function toCSV(rows) {
  if (!rows.length) return ''
  const flat = rows.map(r => {
    const o = {}
    Object.entries(r).forEach(([k, v]) => {
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        Object.entries(v).forEach(([k2, v2]) => { o[`${k}_${k2}`] = v2 })
      } else {
        o[k] = v
      }
    })
    return o
  })
  const headers = Array.from(flat.reduce((set, r) => { Object.keys(r).forEach(k => set.add(k)); return set }, new Set()))
  const escape = v => {
    if (v == null) return ''
    // Spreadsheet apps interpret these prefixes as formulas, even in CSVs.
    const raw = typeof v === 'object' ? JSON.stringify(v) : String(v)
    const s = /^[=+\-@]/.test(raw) ? `'${raw}` : raw
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
  }
  const lines = [headers.join(',')]
  flat.forEach(r => lines.push(headers.map(h => escape(r[h])).join(',')))
  return lines.join('\n')
}

function download(filename, content, type = 'text/csv;charset=utf-8;') {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename
  document.body.appendChild(a); a.click(); document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export default function DataExport() {
  const lock = useRef(false)
  const [busy, setBusy] = useState(null) // table key currently exporting
  const toast = useToast()
  const role = useRole()
  const isAdmin = role === 'admin'

  async function exportTable(t) {
    if (lock.current) return
    lock.current = true; setBusy(t.key)
    try {
      const data = await fetchAll(() => sb.from(t.key).select(t.select).order('id'))
      if (!data.length) return toast('No data for ' + t.label)
      download(`${t.key}-${today()}.csv`, toCSV(data))
      toast(`${data.length} ${t.label} exported`)
    } catch (e) { toast('Export failed: ' + e.message) }
    finally { lock.current = false; setBusy(null) }
  }
  async function exportSnapshot() {
    if (lock.current) return
    lock.current = true; setBusy('snapshot')
    try {
      const snapshot = { format: 'smileblr-records-v1', started_at: new Date().toISOString(), tables: {}, counts: {} }
      for (const t of TABLES) {
        setBusy(t.key)
        snapshot.tables[t.key] = await fetchAll(() => sb.from(t.key).select('*').order('id'))
        snapshot.counts[t.key] = snapshot.tables[t.key].length
      }
      snapshot.finished_at = new Date().toISOString()
      download(`clinic-records-${today()}.json`, JSON.stringify(snapshot, null, 2), 'application/json')
      toast('All record tables exported')
    } catch (e) { toast('Snapshot failed; no partial snapshot downloaded: ' + e.message) }
    finally { lock.current = false; setBusy(null) }
  }

  if (!isAdmin) return <div className="empty">Only admins can export data.</div>

  return (
    <>
      <div className="pagehead"><h2>Data export</h2></div>
      <p style={{ fontSize: '.74rem', color: 'var(--mid)', marginBottom: '1rem' }}>
        Download individual CSVs or all record tables as JSON with row counts. Exports include archived records. Pause editing during export to keep the tables consistent. Uploaded file contents and login accounts are not included; retain separate database and storage backups.
      </p>
      <button className="btn" disabled={!!busy} onClick={exportSnapshot}>{busy ? 'Exporting…' : 'Download all records (JSON)'}</button>
      <table className="tbl">
        <thead><tr><th>Table</th><th></th></tr></thead>
        <tbody>{TABLES.map(t => (
          <tr key={t.key}>
            <td>{t.label}</td>
            <td>
              <button className="btn sm ghost" disabled={!!busy} onClick={() => exportTable(t)}>
                {busy === t.key ? 'Exporting…' : 'Download CSV'}
              </button>
            </td>
          </tr>
        ))}</tbody>
      </table>
    </>
  )
}
