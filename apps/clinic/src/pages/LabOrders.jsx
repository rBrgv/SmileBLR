import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { fmtD, today } from '../lib/format'
import { useToast } from '../components/Toast'
import Modal from '../components/Modal'
import StatusSelect from '../components/StatusSelect'
import ConfirmDialog from '../components/ConfirmDialog'
import PatientPicker from '../components/PatientPicker'

export const LAB_STATUSES = ['sent', 'in_progress', 'received', 'delivered']

export default function LabOrders() {
  const [rows, setRows] = useState(null)
  const [q, setQ] = useState('')
  const [st, setSt] = useState('')
  const [form, setForm] = useState(null) // {} for a new order, the row to edit
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

  // Work that has come back is dated the day it is recorded, unless a date is
  // already there; Edit can set the true day if it was recorded late.
  async function setStatus(order, status) {
    const arrived = status === 'received' || status === 'delivered'
    const update = arrived && !order.received_date ? { status, received_date: today() } : { status }
    const { error } = await sb.from('lab_orders').update(update).eq('id', order.id)
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
        <button className="btn" onClick={() => setForm({})}>+ New order</button>
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
          <thead><tr><th>Patient</th><th>Lab</th><th>Item</th><th>Sent</th><th>Expected return</th><th>Received</th><th>Status</th><th></th></tr></thead>
          <tbody>{view.map(o => {
            const waiting = o.status === 'sent' || o.status === 'in_progress'
            const overdue = waiting && o.expected_return_date && o.expected_return_date < today()
            return (
              <tr key={o.id}>
                <td className="link" onClick={() => nav('/patients/' + o.patients?.id)}>{o.patients?.full_name}</td>
                <td>{o.lab_name || '—'}</td>
                <td>{o.item_description || '—'}{o.notes && <><br /><span style={{ color: 'var(--soft)' }}>{o.notes}</span></>}</td>
                <td>{fmtD(o.sent_date)}</td>
                <td>{fmtD(o.expected_return_date)}{overdue && <> <span className="badge b-pending">overdue</span></>}</td>
                <td>{fmtD(o.received_date)}</td>
                <td><StatusSelect value={o.status} options={LAB_STATUSES} onChange={st => setStatus(o, st)} /></td>
                <td>
                  {waiting && <button className="btn sm green" onClick={() => setStatus(o, 'received')}>Received</button>}{' '}
                  <button className="btn sm ghost" onClick={() => setForm(o)}>Edit</button>{' '}
                  <button className="btn sm ghost danger" onClick={() => setConfirmDel(o.id)}>Delete</button>
                </td>
              </tr>
            )
          })}</tbody>
        </table>
      )}
      {form && <OrderForm order={form.id ? form : null} onClose={() => setForm(null)} onDone={() => { setForm(null); load() }} />}
      {confirmDel && <ConfirmDialog title="Move this lab order to trash?" confirmLabel="Move to trash" onCancel={() => setConfirmDel(null)}
        onConfirm={() => { remove(confirmDel); setConfirmDel(null) }} />}
    </>
  )
}

function OrderForm({ order, onClose, onDone }) {
  const editing = Boolean(order)
  const [f, setF] = useState({
    patient_id: order?.patient_id || '', lab_name: order?.lab_name || '', item_description: order?.item_description || '',
    sent_date: order ? order.sent_date || '' : today(), expected_return_date: order?.expected_return_date || '',
    status: order?.status || 'sent', received_date: order?.received_date || '', notes: order?.notes || '',
  })
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  const set = k => e => setF(x => ({ ...x, [k]: e.target.value }))

  async function save() {
    if (!f.patient_id) return toast('Pick a patient.')
    setBusy(true)
    const arrived = f.status === 'received' || f.status === 'delivered'
    const row = {
      patient_id: f.patient_id, lab_name: f.lab_name.trim() || null, item_description: f.item_description.trim() || null,
      sent_date: f.sent_date || null, expected_return_date: f.expected_return_date || null, notes: f.notes.trim() || null,
      // Work marked as back is dated; work moved back to "sent" for a remake is not.
      received_date: arrived ? (f.received_date || today()) : (f.received_date || null),
      ...(editing ? { status: f.status } : {}),
    }
    const { error } = editing
      ? await sb.from('lab_orders').update(row).eq('id', order.id)
      : await sb.from('lab_orders').insert(row)
    setBusy(false)
    if (error) return toast('Error: ' + error.message)
    toast(editing ? 'Lab order updated' : 'Lab order created'); onDone()
  }

  return (
    <Modal title={editing ? 'Edit lab order' : 'New lab order'} onClose={() => !busy && onClose()}>
      <label>Patient *</label>
      <PatientPicker value={f.patient_id} onChange={id => setF(x => ({ ...x, patient_id: id }))} />
      <label>Lab name</label><input value={f.lab_name} onChange={set('lab_name')} />
      <label>Item description</label><input placeholder="Zirconia crown, tooth 14" value={f.item_description} onChange={set('item_description')} />
      <div className="mrow">
        <div><label>Sent date</label><input type="date" value={f.sent_date} onChange={set('sent_date')} /></div>
        <div><label>Expected return</label><input type="date" value={f.expected_return_date} onChange={set('expected_return_date')} /></div>
      </div>
      {editing && (
        <div className="mrow">
          <div><label>Status</label>
            <select value={f.status} onChange={set('status')}>{LAB_STATUSES.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}</select></div>
          <div><label>Received on</label><input type="date" max={today()} value={f.received_date} onChange={set('received_date')} /></div>
        </div>
      )}
      <label>Notes</label>
      <textarea rows={2} placeholder="Shade, fit, anything to remake" value={f.notes} onChange={set('notes')} />
      <button className="btn" disabled={busy} onClick={save}>{busy ? 'Saving…' : editing ? 'Save changes' : 'Save order'}</button>
    </Modal>
  )
}
