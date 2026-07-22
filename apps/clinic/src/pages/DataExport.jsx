import { useState } from 'react'
import { sb } from '../lib/supabase'
import { today } from '../lib/format'
import { useToast } from '../components/Toast'
import { useRole } from '../lib/RoleContext'

const TABLES = [
  { key: 'patients', label: 'Patients', select: '*' },
  { key: 'appointments', label: 'Appointments', select: '*, patients(full_name), staff(full_name), treatments(name)' },
  { key: 'invoices', label: 'Invoices', select: '*, patients(full_name)' },
  { key: 'treatment_plans', label: 'Treatment Plans', select: '*, patients(full_name)' },
  { key: 'treatment_records', label: 'Treatment Records', select: '*, patients(full_name)' },
  { key: 'prescriptions', label: 'Prescriptions', select: '*, patients(full_name)' },
]

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
    const s = String(v)
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
  }
  const lines = [headers.join(',')]
  flat.forEach(r => lines.push(headers.map(h => escape(r[h])).join(',')))
  return lines.join('\n')
}

function download(filename, content) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename
  document.body.appendChild(a); a.click(); document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export default function DataExport() {
  const [busy, setBusy] = useState(null) // table key currently exporting
  const toast = useToast()
  const role = useRole()
  const isAdmin = role === 'admin'

  async function exportTable(t) {
    setBusy(t.key)
    const { data, error } = await sb.from(t.key).select(t.select).limit(10000)
    setBusy(null)
    if (error) return toast('Error: ' + error.message)
    if (!data?.length) return toast('No data to export for ' + t.label)
    download(`${t.key}-${today()}.csv`, toCSV(data))
    toast(t.label + ' exported')
  }

  if (!isAdmin) return <div className="empty">Only admins can export data.</div>

  return (
    <>
      <div className="pagehead"><h2>Data export</h2></div>
      <p style={{ fontSize: '.74rem', color: 'var(--mid)', marginBottom: '1rem' }}>
        Download a CSV snapshot of core records — for backups, migrating elsewhere, or handing data to your accountant.
      </p>
      <table className="tbl">
        <thead><tr><th>Table</th><th></th></tr></thead>
        <tbody>{TABLES.map(t => (
          <tr key={t.key}>
            <td>{t.label}</td>
            <td>
              <button className="btn sm ghost" disabled={busy === t.key} onClick={() => exportTable(t)}>
                {busy === t.key ? 'Exporting…' : 'Download CSV'}
              </button>
            </td>
          </tr>
        ))}</tbody>
      </table>
    </>
  )
}
