import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { fmtD, today } from '../lib/format'
import { useToast } from '../components/Toast'
import Modal from '../components/Modal'
import ConfirmDialog from '../components/ConfirmDialog'

export default function Referrals() {
  const [rows, setRows] = useState(null)
  const [q, setQ] = useState('')
  const [show, setShow] = useState(false)
  const [confirmDel, setConfirmDel] = useState(null)
  const toast = useToast()
  const nav = useNavigate()

  async function load() {
    const { data, error } = await sb.from('referrals').select('*, patients(id,full_name), staff(full_name)')
      .is('deleted_at', null).order('referral_date', { ascending: false }).limit(300)
    if (error) { toast('Error: ' + error.message); return setRows([]) }
    setRows(data)
  }
  useEffect(() => { load() }, [])

  async function remove(id) {
    const { error } = await sb.from('referrals').update({ deleted_at: new Date().toISOString() }).eq('id', id)
    if (error) return toast('Error: ' + error.message)
    toast('Moved to trash', { actionLabel: 'Undo', onAction: async () => { await sb.from('referrals').update({ deleted_at: null }).eq('id', id); load() } })
    load()
  }

  if (!rows) return <div className="empty">Loading…</div>
  const view = rows.filter(r => !q || (r.patients?.full_name || '').toLowerCase().includes(q.toLowerCase()))

  return (
    <>
      <div className="pagehead">
        <h2>Referrals</h2>
        <button className="btn" onClick={() => setShow(true)}>+ New referral</button>
      </div>
      <div className="bar"><input placeholder="Search patient…" value={q} onChange={e => setQ(e.target.value)} /></div>
      {!view.length ? <div className="empty">No referrals yet.</div> : (
        <table className="tbl">
          <thead><tr><th>Date</th><th>Patient</th><th>Referred to</th><th>Referred by</th><th>Reason</th><th></th></tr></thead>
          <tbody>{view.map(r => (
            <tr key={r.id}>
              <td>{fmtD(r.referral_date)}</td>
              <td className="link" onClick={() => nav('/patients/' + r.patients?.id)}>{r.patients?.full_name}</td>
              <td>{r.referred_to || '—'}</td><td>{r.staff?.full_name || '—'}</td><td>{r.reason || '—'}</td>
              <td><button className="btn sm ghost danger" onClick={() => setConfirmDel(r.id)}>Delete</button></td>
            </tr>
          ))}</tbody>
        </table>
      )}
      {show && <ReferralForm onClose={() => setShow(false)} onDone={() => { setShow(false); load() }} />}
      {confirmDel && <ConfirmDialog title="Move this referral to trash?" confirmLabel="Move to trash" onCancel={() => setConfirmDel(null)}
        onConfirm={() => { remove(confirmDel); setConfirmDel(null) }} />}
    </>
  )
}

function ReferralForm({ onClose, onDone }) {
  const [patients, setPatients] = useState([])
  const [doctors, setDoctors] = useState([])
  const [f, setF] = useState({ patient_id: '', referred_to: '', referred_by: '', reason: '', referral_date: today(), notes: '' })
  const toast = useToast()
  const set = k => e => setF(x => ({ ...x, [k]: e.target.value }))

  useEffect(() => {
    sb.from('patients').select('id,full_name').order('full_name').then(({ data }) => {
      setPatients(data ?? [])
      if (data?.length) setF(x => ({ ...x, patient_id: data[0].id }))
    })
    sb.from('staff').select('*').eq('active', true).eq('role', 'doctor').order('full_name').then(({ data }) => setDoctors(data ?? []))
  }, [])

  async function save() {
    if (!f.patient_id) return toast('Pick a patient.')
    const { error } = await sb.from('referrals').insert({
      patient_id: f.patient_id, referred_to: f.referred_to.trim() || null, referred_by: f.referred_by || null,
      reason: f.reason.trim() || null, referral_date: f.referral_date || null, notes: f.notes.trim() || null,
    })
    if (error) return toast('Error: ' + error.message)
    toast('Referral created'); onDone()
  }

  return (
    <Modal title="New referral" onClose={onClose}>
      <label>Patient *</label>
      <select value={f.patient_id} onChange={set('patient_id')}>
        {patients.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
      </select>
      <label>Referred to</label><input placeholder="Specialist / clinic name" value={f.referred_to} onChange={set('referred_to')} />
      <div className="mrow">
        <div><label>Referred by</label><select value={f.referred_by} onChange={set('referred_by')}>
          <option value="">—</option>{doctors.map(d => <option key={d.id} value={d.id}>{d.full_name}</option>)}</select></div>
        <div><label>Date</label><input type="date" value={f.referral_date} onChange={set('referral_date')} /></div>
      </div>
      <label>Reason</label><input value={f.reason} onChange={set('reason')} />
      <label>Notes</label><input value={f.notes} onChange={set('notes')} />
      <button className="btn" onClick={save}>Save referral</button>
    </Modal>
  )
}
