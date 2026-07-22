import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { fmtDT } from '../lib/format'
import { useToast } from '../components/Toast'
import ConfirmDialog from '../components/ConfirmDialog'
import { useRole } from '../lib/RoleContext'
import { logActivity } from '../lib/activityLog'

const TYPES = [
  { key: 'treatment_plans', label: 'Treatment Plans', select: '*, patients(id,full_name)', title: r => `${r.patients?.full_name || '—'} — ${r.plan_description || 'Plan'}` },
  { key: 'treatment_records', label: 'Treatment Records', select: '*, patients(id,full_name), treatments(name)', title: r => `${r.patients?.full_name || '—'} — ${r.treatments?.name || 'Record'}` },
  { key: 'xray_images', label: 'X-Rays', select: '*, patients(id,full_name)', title: r => `${r.patients?.full_name || '—'} — ${r.image_type}${r.tooth_number ? ' · Tooth ' + r.tooth_number : ''}` },
  { key: 'lab_orders', label: 'Lab Orders', select: '*, patients(id,full_name)', title: r => `${r.patients?.full_name || '—'} — ${r.lab_name || 'Lab order'}` },
  { key: 'referrals', label: 'Referrals', select: '*, patients(id,full_name)', title: r => `${r.patients?.full_name || '—'} — ${r.referred_to || 'Referral'}` },
  { key: 'consent_forms', label: 'Consent Forms', select: '*, patients(id,full_name)', title: r => `${r.patients?.full_name || '—'} — ${r.procedure}` },
  { key: 'insurance_claims', label: 'Insurance Claims', select: '*, patients(id,full_name)', title: r => `${r.patients?.full_name || '—'} — ${r.insurer_name || 'Claim'}` },
  { key: 'patient_documents', label: 'Patient Documents', select: '*, patients(id,full_name)', title: r => `${r.patients?.full_name || '—'} — ${r.file_name || r.doc_type}` },
]

export default function Trash() {
  const [type, setType] = useState(TYPES[0].key)
  const [rows, setRows] = useState(null)
  const [purgeTarget, setPurgeTarget] = useState(null)
  const toast = useToast()
  const nav = useNavigate()
  const role = useRole()
  const canPurge = role === 'admin' || role === 'doctor'
  const cfg = TYPES.find(t => t.key === type)

  async function load() {
    setRows(null)
    const { data, error } = await sb.from(type).select(cfg.select)
      .not('deleted_at', 'is', null).order('deleted_at', { ascending: false }).limit(200)
    if (error) { toast('Error: ' + error.message); return setRows([]) }
    setRows(data)
  }
  useEffect(() => { load() }, [type])

  async function restore(row) {
    const { error } = await sb.from(type).update({ deleted_at: null }).eq('id', row.id)
    if (error) return toast('Error: ' + error.message)
    toast('Restored'); load()
  }

  async function purge(row) {
    if ((type === 'xray_images' || type === 'patient_documents') && row.file_url) {
      await sb.storage.from('xray-images').remove([row.file_url])
    }
    const { error } = await sb.from(type).delete().eq('id', row.id)
    if (error) return toast('Error: ' + error.message)
    logActivity('trash.purged', type, row.id, `Permanently deleted a ${cfg.label.toLowerCase().slice(0, -1)}: ${cfg.title(row)}`)
    toast('Permanently deleted'); load()
  }

  return (
    <>
      <div className="pagehead"><h2>Trash</h2></div>
      <p style={{ fontSize: '.74rem', color: 'var(--mid)', marginBottom: '1rem' }}>
        Deleted items land here first so nothing is lost to a mis-click. Restore them, or delete permanently to remove for good.
        {!canPurge && ' Permanent deletion is limited to admins and doctors.'}
      </p>
      <div className="bar">
        <select value={type} onChange={e => setType(e.target.value)}>
          {TYPES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
        </select>
      </div>
      {!rows ? <div className="empty">Loading…</div> : !rows.length ? <div className="empty">Trash is empty for {cfg.label.toLowerCase()}.</div> : (
        <table className="tbl">
          <thead><tr><th>Item</th><th>Deleted</th><th></th></tr></thead>
          <tbody>{rows.map(r => (
            <tr key={r.id}>
              <td className={r.patients?.id ? 'link' : ''} onClick={() => r.patients?.id && nav('/patients/' + r.patients.id)}>{cfg.title(r)}</td>
              <td>{fmtDT(r.deleted_at)}</td>
              <td>
                <button className="btn sm ghost" onClick={() => restore(r)}>Restore</button>{' '}
                {canPurge && <button className="btn sm ghost danger" onClick={() => setPurgeTarget(r)}>Delete permanently</button>}
              </td>
            </tr>
          ))}</tbody>
        </table>
      )}
      {purgeTarget && <ConfirmDialog title="Delete this permanently?" body="This cannot be undone — even from Trash." confirmLabel="Delete forever"
        onCancel={() => setPurgeTarget(null)} onConfirm={() => { purge(purgeTarget); setPurgeTarget(null) }} />}
    </>
  )
}
