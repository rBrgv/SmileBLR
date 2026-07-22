import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { fmtD } from '../lib/format'
import { useToast } from '../components/Toast'
import ConfirmDialog from '../components/ConfirmDialog'
import { RecordForm } from '../components/TreatmentRecordPanel'

export default function TreatmentRecords() {
  const [rows, setRows] = useState(null)
  const [q, setQ] = useState('')
  const [show, setShow] = useState(false)
  const [confirmDel, setConfirmDel] = useState(null)
  const toast = useToast()
  const nav = useNavigate()

  async function load() {
    const { data, error } = await sb.from('treatment_records')
      .select('*, patients(id,full_name), treatments(name), staff(full_name)')
      .is('deleted_at', null).order('performed_date', { ascending: false }).limit(300)
    if (error) { toast('Error: ' + error.message); return setRows([]) }
    setRows(data)
  }
  useEffect(() => { load() }, [])

  async function remove(id) {
    const { error } = await sb.from('treatment_records').update({ deleted_at: new Date().toISOString() }).eq('id', id)
    if (error) return toast('Error: ' + error.message)
    toast('Moved to trash', { actionLabel: 'Undo', onAction: async () => { await sb.from('treatment_records').update({ deleted_at: null }).eq('id', id); load() } })
    load()
  }

  async function markCalled(id) {
    const { error } = await sb.from('treatment_records').update({ follow_up_required: false }).eq('id', id)
    if (error) return toast('Error: ' + error.message)
    toast('Marked as called'); load()
  }

  if (!rows) return <div className="empty">Loading…</div>
  const view = rows.filter(r => !q || (r.patients?.full_name || '').toLowerCase().includes(q.toLowerCase()))

  return (
    <>
      <div className="pagehead">
        <h2>Treatment records</h2>
        <button className="btn" onClick={() => setShow(true)}>+ New record</button>
      </div>
      <div className="bar"><input placeholder="Search patient…" value={q} onChange={e => setQ(e.target.value)} /></div>
      {!view.length ? <div className="empty">No treatment records yet.</div> : (
        <table className="tbl">
          <thead><tr><th>Date</th><th>Patient</th><th>Treatment</th><th>Tooth</th><th>By</th><th>Follow-up</th><th></th></tr></thead>
          <tbody>{view.map(r => (
            <tr key={r.id}>
              <td>{fmtD(r.performed_date)}</td>
              <td className="link" onClick={() => nav('/patients/' + r.patients?.id)}>{r.patients?.full_name}</td>
              <td>{r.treatments?.name || '—'}</td><td>{r.tooth_number || '—'}</td>
              <td>{r.staff?.full_name || '—'}</td>
              <td>{r.follow_up_required ? fmtD(r.follow_up_date) : '—'}
                {r.follow_up_required && <>{' '}<button className="btn sm ghost" onClick={() => markCalled(r.id)}>Mark called</button></>}</td>
              <td>
                <a className="btn sm ghost" target="_blank" rel="noreferrer" href={'/print/post-op/' + r.id}>Post-op</a>{' '}
                <button className="btn sm ghost danger" onClick={() => setConfirmDel(r.id)}>Delete</button>
              </td>
            </tr>
          ))}</tbody>
        </table>
      )}
      {show && <RecordForm onClose={() => setShow(false)} onDone={() => { setShow(false); load() }} />}
      {confirmDel && <ConfirmDialog title="Move this record to trash?" confirmLabel="Move to trash" onCancel={() => setConfirmDel(null)}
        onConfirm={() => { remove(confirmDel); setConfirmDel(null) }} />}
    </>
  )
}
