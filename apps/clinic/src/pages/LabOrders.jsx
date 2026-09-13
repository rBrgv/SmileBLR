import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { fmtD, today } from '../lib/format'
import { useToast } from '../components/Toast'
import Modal from '../components/Modal'
import StatusSelect from '../components/StatusSelect'
import ConfirmDialog from '../components/ConfirmDialog'

export const LAB_STATUSES = ['sent', 'in_progress', 'received', 'delivered']

export default function LabOrders() {
  const [rows, setRows] = useState(null)
  const [q, setQ] = useState('')
  const [st, setSt] = useState('')
  const [show, setShow] = useState(false)
  const [confirmDel, setConfirmDel] = useState(null)
  const toast = useToast()
  const nav = useNavigate()

  async function load() {
    const { data, error } = await sb.from('lab_orders').select('*, patients(id,full_name)')
      .is('deleted_at', null).order('sent_date', { ascending: false }).limit(300)
    if (error) { toast('Error: ' + error.message); return setRows([]) }
    setRows(data)
  }
  useEffect(() => { load() }, [])

  async function setStatus(id, status) {
    const { error } = await sb.from('lab_orders').update({ status }).eq('id', id)
    if (error) return toast('Error: ' + error.message)
    toast('Order ' + status.replace('_', ' ')); load()
  }

  async function remove(id) {
    const { error } = await sb.from('lab_orders').update({ deleted_at: new Date().toISOString() }).eq('id', id)
    if (error) return toast('Error: ' + error.message)
    toast('Moved to trash', { actionLabel: 'Undo', onAction: async () => { await sb.from('lab_orders').update({ deleted_at: null }).eq('id', id); load() } })
    load()
  }

  if (!rows) return <div className="empty">Loading…</div>
  const view = rows.filter(o =>
    (!q || (o.patients?.full_name || '').toLowerCase().includes(q.toLowerCase())) && (!st || o.status === st))

  return (
    <>
      <div className="pagehead">
        <h2>Lab orders</h2>
        <button className="btn" onClick={() => setShow(true)}>+ New order</button>
      </div>
      <div className="bar">
        <input placeholder="Search patient…" value={q} onChange={e => setQ(e.target.value)} />
        <select value={st} onChange={e => setSt(e.target.value)}>
          <option value="">All statuses</option>
          {LAB_STATUSES.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
        </select>
      </div>
      {!view.length ? <div className="empty">No lab orders yet.</div> : (
        <table className="tbl">
          <thead><tr><th>Patient</th><th>Lab</th><th>Item</th><th>Sent</th><th>Expected return</th><th>Status</th><th></th></tr></thead>
          <tbody>{view.map(o => (
            <tr key={o.id}>
              <td className="link" onClick={() => nav('/patients/' + o.patients?.id)}>{o.patients?.full_name}</td>
              <td>{o.lab_name || '—'}</td><td>{o.item_description || '—'}</td>
              <td>{fmtD(o.sent_date)}</td><td>{fmtD(o.expected_return_date)}</td>
              <td><StatusSelect value={o.status} options={LAB_STATUSES} onChange={s => setStatus(o.id, s)} /></td>
              <td><button className="btn sm ghost danger" onClick={() => setConfirmDel(o.id)}>Delete</button></td>
            </tr>
          ))}</tbody>
        </table>
      )}
      {show && <OrderForm onClose={() => setShow(false)} onDone={() => { setShow(false); load() }} />}
      {confirmDel && <ConfirmDialog title="Move this lab order to trash?" confirmLabel="Move to trash" onCancel={() => setConfirmDel(null)}
        onConfirm={() => { remove(confirmDel); setConfirmDel(null) }} />}
    </>
  )
}

function OrderForm({ onClose, onDone }) {
  const [patients, setPatients] = useState([])
  const [f, setF] = useState({ patient_id: '', lab_name: '', item_description: '', sent_date: today(), expected_return_date: '' })
  const toast = useToast()
  const set = k => e => setF(x => ({ ...x, [k]: e.target.value }))

  useEffect(() => {
    sb.from('patients').select('id,full_name').order('full_name').then(({ data }) => {
      setPatients(data ?? [])
      if (data?.length) setF(x => ({ ...x, patient_id: data[0].id }))
    })
  }, [])

  async function save() {
    if (!f.patient_id) return toast('Pick a patient.')
    const { error } = await sb.from('lab_orders').insert({
      patient_id: f.patient_id, lab_name: f.lab_name.trim() || null, item_description: f.item_description.trim() || null,
      sent_date: f.sent_date || null, expected_return_date: f.expected_return_date || null,
    })
    if (error) return toast('Error: ' + error.message)
    toast('Lab order created'); onDone()
  }

  return (
    <Modal title="New lab order" onClose={onClose}>
      <label>Patient *</label>
      <select value={f.patient_id} onChange={set('patient_id')}>
        {patients.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
      </select>
      <label>Lab name</label><input value={f.lab_name} onChange={set('lab_name')} />
      <label>Item description</label><input placeholder="Zirconia crown, tooth 14" value={f.item_description} onChange={set('item_description')} />
      <div className="mrow">
        <div><label>Sent date</label><input type="date" value={f.sent_date} onChange={set('sent_date')} /></div>
        <div><label>Expected return</label><input type="date" value={f.expected_return_date} onChange={set('expected_return_date')} /></div>
      </div>
      <button className="btn" onClick={save}>Save order</button>
    </Modal>
  )
}
