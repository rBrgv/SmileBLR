import { useEffect, useMemo, useState } from 'react'
import { sb } from '../lib/supabase'
import { fetchAll } from '../lib/handoff'
import { fmtD } from '../lib/format'
import { ageLabel } from '../lib/age'
import { useRole } from '../lib/RoleContext'
import { useToast } from '../components/Toast'
import ConfirmDialog from '../components/ConfirmDialog'
import { logActivity } from '../lib/activityLog'
import { duplicateGroups, describeData } from '../lib/duplicates'

// What is recorded against each patient, by table, so the record with the
// history can be told from the one that was typed in twice.
const COUNTED = [
  ['records', 'treatment_records', q => q.is('deleted_at', null)],
  ['bills', 'invoices'], ['appointments', 'appointments'], ['prescriptions', 'prescriptions'],
  ['consultations', 'consultations'], ['consents', 'consent_forms', q => q.is('deleted_at', null)],
]

export default function Duplicates() {
  const [patients, setPatients] = useState(null)
  const [counts, setCounts] = useState({})
  const [keep, setKeep] = useState({}) // group key -> the record chosen to keep
  const [hidden, setHidden] = useState([])
  const [confirm, setConfirm] = useState(null) // {type: 'merge' | 'archive', ...}
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  const role = useRole()
  const canMerge = role === 'admin' || role === 'doctor'
  const canArchive = role === 'admin'

  async function load() {
    try {
      const list = await fetchAll(() => sb.from('patients').select('id, full_name, phone, patient_code, manual_id, gender, created_at, approx_age, approx_age_recorded_on, date_of_birth')
        .is('merged_into', null).is('deleted_at', null).order('id'))
      const tally = {}
      for (const [key, table, refine] of COUNTED) {
        const rows = await fetchAll(() => (refine ?? (q => q))(sb.from(table).select('patient_id')).order('id'))
        for (const r of rows) if (r.patient_id) (tally[r.patient_id] ??= {})[key] = (tally[r.patient_id][key] ?? 0) + 1
      }
      setCounts(tally); setPatients(list)
    } catch (e) { toast('Error: ' + e.message); setPatients([]) }
  }
  useEffect(() => { load() }, [])

  const groups = useMemo(() => patients ? duplicateGroups(patients, counts).filter(g => !hidden.includes(g.key)) : [], [patients, counts, hidden])

  async function run() {
    setBusy(true)
    try {
      if (confirm.type === 'merge') {
        for (const other of confirm.others) {
          const { error } = await sb.rpc('merge_patients', { primary_id: confirm.keeper.id, duplicate_id: other.id })
          if (error) throw error
          logActivity('patient.merged', 'patients', other.id, `Merged ${other.patient_code} into ${confirm.keeper.patient_code} (duplicate screen)`)
        }
        toast(`${confirm.others.length} duplicate${confirm.others.length > 1 ? 's' : ''} merged into ${confirm.keeper.patient_code}`)
      } else {
        const { error } = await sb.rpc('archive_patient', { p_id: confirm.patient.id })
        if (error) throw error
        logActivity('patient.archived', 'patients', confirm.patient.id, `Archived ${confirm.patient.patient_code} (duplicate screen)`)
        toast(confirm.patient.patient_code + ' archived')
      }
      setConfirm(null); await load()
    } catch (e) { toast('Error: ' + e.message); setConfirm(null) }
    finally { setBusy(false) }
  }

  if (!patients) return <div className="empty">Looking for duplicates…</div>
  return (
    <>
      <div className="pagehead"><h2>Possible duplicates</h2><button className="btn ghost" onClick={load}>Refresh</button></div>
      <p style={{ fontSize: '.78rem', color: 'var(--mid)', marginBottom: '1rem', maxWidth: '46rem' }}>
        Patients with exactly the same name. <b>The same name is not always the same person</b>, so check the age, phone and what is recorded
        against each before you decide. Merging moves everything onto the record you keep and cannot be undone. A record with nothing
        recorded can be archived instead, and restored from Trash.
        {!canMerge && ' Only doctors and admins can merge; only admins can archive.'}
      </p>
      {!groups.length ? <div className="empty">No patient names appear twice.</div> : groups.map(g => {
        const chosen = keep[g.key] ?? g.keep
        const keeper = g.members.find(m => m.id === chosen)
        const others = g.members.filter(m => m.id !== chosen)
        return (
          <div key={g.key} className="overview-card" style={{ marginBottom: '1rem' }}>
            <b>{g.name}</b> <span className="sub">· {g.members.length} records</span>
            <table className="tbl" style={{ margin: '.6rem 0' }}>
              <thead><tr><th>Keep</th><th>ID</th><th>Phone</th><th>Age</th><th>Registered</th><th>Recorded</th><th></th></tr></thead>
              <tbody>{g.members.map(m => (
                <tr key={m.id}>
                  <td><input type="radio" style={{ width: 'auto' }} name={'keep-' + g.key} checked={m.id === chosen} onChange={() => setKeep(k => ({ ...k, [g.key]: m.id }))} aria-label={'Keep ' + m.patient_code} /></td>
                  <td>{m.patient_code}{m.manual_id ? ' · file ' + m.manual_id : ''}</td>
                  <td>{m.phone && m.phone !== 'N/A' ? m.phone : '—'}</td>
                  <td>{ageLabel(m) || '—'}{m.gender ? ' · ' + m.gender : ''}</td>
                  <td>{fmtD(m.created_at)}</td>
                  <td>{describeData(m.counts)}</td>
                  <td>
                    <a className="btn sm ghost" target="_blank" rel="noreferrer" href={'/patients/' + m.id}>Open</a>{' '}
                    {canArchive && <button className="btn sm ghost danger" disabled={m.data > 0} title={m.data > 0 ? 'Has records: merge instead' : 'Archive this record'}
                      onClick={() => setConfirm({ type: 'archive', patient: m })}>Archive</button>}
                  </td>
                </tr>
              ))}</tbody>
            </table>
            {canMerge && <button className="btn sm danger" onClick={() => setConfirm({ type: 'merge', keeper, others })}>Merge {others.length > 1 ? 'the other ' + others.length : 'the other'} into {keeper.patient_code}</button>}{' '}
            <button className="btn sm ghost" onClick={() => setHidden(h => [...h, g.key])}>Not duplicates · hide for now</button>
          </div>
        )
      })}
      {confirm?.type === 'merge' && (
        <ConfirmDialog title={`Merge into ${confirm.keeper.patient_code}?`} confirmLabel={busy ? 'Merging…' : 'Merge'} onCancel={() => setConfirm(null)} onConfirm={run}
          body={`${confirm.others.map(o => `${o.patient_code} (${describeData(o.counts)})`).join(', ')} will be moved onto ${confirm.keeper.patient_code} (${describeData(confirm.keeper.counts)}), and hidden from the patient list. This cannot be undone.`} />
      )}
      {confirm?.type === 'archive' && (
        <ConfirmDialog title={`Archive ${confirm.patient.patient_code}?`} confirmLabel={busy ? 'Archiving…' : 'Archive'} onCancel={() => setConfirm(null)} onConfirm={run}
          body="It disappears from the patient list and search, and can be restored from Trash." />
      )}
    </>
  )
}
