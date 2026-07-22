import { useEffect, useState } from 'react'
import { sb } from '../lib/supabase'
import { fmtD, today } from '../lib/format'
import { useToast } from './Toast'
import Modal from './Modal'
import VoiceNote from './VoiceNote'
import ConfirmDialog from './ConfirmDialog'

export function RecordForm({ patientId, stageId, onClose, onDone }) {
  const [patients, setPatients] = useState([])
  const [appts, setAppts] = useState([])
  const [treatments, setTreatments] = useState([])
  const [staff, setStaff] = useState([])
  const [f, setF] = useState({
    patient_id: patientId || '', appointment_id: '', treatment_id: '', tooth_number: '',
    performed_by: '', performed_date: today(), notes: '', follow_up_required: false, follow_up_date: '',
  })
  const toast = useToast()
  const set = k => e => setF(x => ({ ...x, [k]: e.target.value }))
  const pid = patientId || f.patient_id

  useEffect(() => {
    if (!patientId) sb.from('patients').select('id,full_name').order('full_name').then(({ data }) => {
      setPatients(data ?? [])
      if (data?.length) setF(x => ({ ...x, patient_id: data[0].id }))
    })
    sb.from('treatments').select('*').order('name').then(({ data }) => setTreatments(data ?? []))
    sb.from('staff').select('*').eq('active', true).order('full_name').then(({ data }) => setStaff(data ?? []))
  }, [])

  useEffect(() => {
    if (!pid) return
    sb.from('appointments').select('id, appointment_time').eq('patient_id', pid).order('appointment_time', { ascending: false })
      .then(({ data }) => setAppts(data ?? []))
  }, [pid])

  async function save() {
    if (!pid) return toast('Pick a patient.')
    const { error } = await sb.from('treatment_records').insert({
      patient_id: pid, appointment_id: f.appointment_id || null, treatment_id: f.treatment_id || null,
      tooth_number: parseInt(f.tooth_number) || null, performed_by: f.performed_by || null,
      performed_date: f.performed_date || null, notes: f.notes.trim() || null,
      follow_up_required: f.follow_up_required, follow_up_date: f.follow_up_required ? (f.follow_up_date || null) : null,
      stage_id: stageId || null,
    })
    if (error) return toast('Error: ' + error.message)
    toast('Treatment record saved'); onDone()
  }

  return (
    <Modal title="New treatment record" onClose={onClose}>
      {!patientId && (
        <>
          <label>Patient *</label>
          <select value={f.patient_id} onChange={set('patient_id')}>
            {patients.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
          </select>
        </>
      )}
      <div className="mrow">
        <div><label>Treatment</label><select value={f.treatment_id} onChange={set('treatment_id')}>
          <option value="">—</option>{treatments.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></div>
        <div><label>Tooth number</label><input type="number" min="1" max="32" value={f.tooth_number} onChange={set('tooth_number')} /></div>
      </div>
      <div className="mrow">
        <div><label>Appointment</label><select value={f.appointment_id} onChange={set('appointment_id')}>
          <option value="">—</option>{appts.map(a => <option key={a.id} value={a.id}>{fmtD(a.appointment_time)}</option>)}</select></div>
        <div><label>Performed by</label><select value={f.performed_by} onChange={set('performed_by')}>
          <option value="">—</option>{staff.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}</select></div>
      </div>
      <label>Date</label><input type="date" value={f.performed_date} onChange={set('performed_date')} />
      <label>Notes</label>
      <VoiceNote value={f.notes} onChange={v => setF(x => ({ ...x, notes: v }))} placeholder="What was done…" />
      <label style={{ display: 'flex', alignItems: 'center', gap: '.5rem', textTransform: 'none', fontSize: '.78rem', color: 'var(--ink)' }}>
        <input type="checkbox" style={{ width: 'auto' }} checked={f.follow_up_required}
          onChange={e => setF(x => {
            const checked = e.target.checked
            if (checked && !x.follow_up_date) {
              const d = new Date(); d.setDate(d.getDate() + 2)
              return { ...x, follow_up_required: true, follow_up_date: d.toISOString().slice(0, 10) }
            }
            return { ...x, follow_up_required: checked }
          })} /> Follow-up call required (defaults to 2 days later — shows up on the Dashboard's daily call list)
      </label>
      {f.follow_up_required && <><label>Follow-up date</label><input type="date" value={f.follow_up_date} onChange={set('follow_up_date')} /></>}
      <button className="btn" onClick={save}>Save record</button>
    </Modal>
  )
}

export default function TreatmentRecordPanel({ patientId }) {
  const [rows, setRows] = useState(null)
  const [show, setShow] = useState(false)
  const [confirmDel, setConfirmDel] = useState(null)
  const toast = useToast()

  async function load() {
    const { data, error } = await sb.from('treatment_records').select('*, treatments(name), staff(full_name)')
      .eq('patient_id', patientId).is('deleted_at', null).order('performed_date', { ascending: false })
    if (error) { toast('Error: ' + error.message); return setRows([]) }
    setRows(data)
  }
  useEffect(() => { load() }, [patientId])

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
  return (
    <>
      <button className="btn" style={{ marginBottom: '.75rem' }} onClick={() => setShow(true)}>+ New record</button>
      {!rows.length ? <div className="empty">No treatment records yet.</div> : (
        <table className="tbl">
          <thead><tr><th>Date</th><th>Treatment</th><th>Tooth</th><th>By</th><th>Follow-up</th><th></th></tr></thead>
          <tbody>{rows.map(r => (
            <tr key={r.id}>
              <td>{fmtD(r.performed_date)}</td><td>{r.treatments?.name || '—'}</td>
              <td>{r.tooth_number || '—'}</td><td>{r.staff?.full_name || '—'}</td>
              <td>{r.follow_up_required ? fmtD(r.follow_up_date) : '—'}
                {r.follow_up_required && <>{' '}<button className="btn sm ghost" onClick={() => markCalled(r.id)}>Mark called</button></>}</td>
              <td>
                <a className="btn sm ghost" target="_blank" rel="noreferrer" href={'/print/post-op/' + r.id}>Post-op instructions</a>{' '}
                <button className="btn sm ghost danger" onClick={() => setConfirmDel(r.id)}>Delete</button>
              </td>
            </tr>
          ))}</tbody>
        </table>
      )}
      {show && <RecordForm patientId={patientId} onClose={() => setShow(false)} onDone={() => { setShow(false); load() }} />}
      {confirmDel && <ConfirmDialog title="Move this record to trash?" confirmLabel="Move to trash" onCancel={() => setConfirmDel(null)}
        onConfirm={() => { remove(confirmDel); setConfirmDel(null) }} />}
    </>
  )
}
