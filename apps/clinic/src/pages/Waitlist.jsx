import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { fmtD, digits, today } from '../lib/format'
import { useToast } from '../components/Toast'
import Modal from '../components/Modal'
import { AppointmentForm } from './Appointments'

export default function Waitlist() {
  const [rows, setRows] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [bookFor, setBookFor] = useState(null)
  const toast = useToast()
  const nav = useNavigate()

  async function load() {
    const { data, error } = await sb.from('appointment_waitlist')
      .select('*, patients(id,full_name,phone), staff(full_name), treatments(name)')
      .eq('status', 'waiting').order('added_date')
    if (error) { toast('Error: ' + error.message); return setRows([]) }
    setRows(data)
  }
  useEffect(() => { load() }, [])

  async function remove(id) {
    const { error } = await sb.from('appointment_waitlist').update({ status: 'cancelled' }).eq('id', id)
    if (error) return toast('Error: ' + error.message)
    toast('Removed from waitlist'); load()
  }

  async function markBooked(id) {
    await sb.from('appointment_waitlist').update({ status: 'booked' }).eq('id', id)
    load()
  }

  if (!rows) return <div className="empty">Loading…</div>

  return (
    <>
      <div className="pagehead">
        <h2>Waitlist</h2>
        <button className="btn" onClick={() => setShowForm(true)}>+ Add to waitlist</button>
      </div>
      <p style={{ fontSize: '.74rem', color: 'var(--mid)', marginBottom: '1rem' }}>
        Patients wanting an earlier slot than what's open. When something cancels, work down this list instead of leaving the chair empty.
      </p>
      {!rows.length ? <div className="empty">Waitlist is empty.</div> : (
        <table className="tbl">
          <thead><tr><th>Patient</th><th>Doctor</th><th>Treatment</th><th>Notes</th><th>Added</th><th></th></tr></thead>
          <tbody>{rows.map(r => {
            const msg = encodeURIComponent(`Hi ${r.patients?.full_name || ''}, this is Smile Bengaluru. A slot just opened up — would you like to come in? Reply here to confirm a time.`)
            return (
              <tr key={r.id}>
                <td className="link" onClick={() => nav('/patients/' + r.patient_id)}>{r.patients?.full_name}</td>
                <td>{r.staff?.full_name || 'Any'}</td>
                <td>{r.treatments?.name || '—'}</td>
                <td>{r.notes || '—'}</td>
                <td>{fmtD(r.added_date)}</td>
                <td>
                  <a className="btn sm green" target="_blank" rel="noreferrer" href={`https://wa.me/${digits(r.patients?.phone)}?text=${msg}`}>WhatsApp</a>{' '}
                  <button className="btn sm ghost" onClick={() => setBookFor(r)}>Book now</button>{' '}
                  <button className="btn sm ghost danger" onClick={() => remove(r.id)}>Remove</button>
                </td>
              </tr>
            )
          })}</tbody>
        </table>
      )}
      {showForm && <WaitlistForm onClose={() => setShowForm(false)} onDone={() => { setShowForm(false); load() }} />}
      {bookFor && (
        <AppointmentForm patientId={bookFor.patient_id} onClose={() => setBookFor(null)}
          onDone={() => { markBooked(bookFor.id); setBookFor(null); toast('Appointment booked from waitlist') }} />
      )}
    </>
  )
}

function WaitlistForm({ onClose, onDone }) {
  const [patients, setPatients] = useState([])
  const [doctors, setDoctors] = useState([])
  const [treatments, setTreatments] = useState([])
  const [f, setF] = useState({ patient_id: '', doctor_id: '', treatment_id: '', notes: '' })
  const toast = useToast()
  const set = k => e => setF(x => ({ ...x, [k]: e.target.value }))

  useEffect(() => {
    sb.from('patients').select('id,full_name,phone').order('full_name').then(({ data }) => {
      setPatients(data ?? [])
      if (data?.length) setF(x => ({ ...x, patient_id: data[0].id }))
    })
    sb.from('staff').select('*').eq('active', true).eq('role', 'doctor').order('full_name').then(({ data }) => setDoctors(data ?? []))
    sb.from('treatments').select('*').order('name').then(({ data }) => setTreatments(data ?? []))
  }, [])

  async function save() {
    if (!f.patient_id) return toast('Pick a patient.')
    const { error } = await sb.from('appointment_waitlist').insert({
      patient_id: f.patient_id, doctor_id: f.doctor_id || null, treatment_id: f.treatment_id || null,
      added_date: today(), notes: f.notes.trim() || null,
    })
    if (error) return toast('Error: ' + error.message)
    toast('Added to waitlist'); onDone()
  }

  return (
    <Modal title="Add to waitlist" onClose={onClose}>
      <label>Patient *</label>
      <select value={f.patient_id} onChange={set('patient_id')}>
        {patients.map(p => <option key={p.id} value={p.id}>{p.full_name} · {p.phone}</option>)}
      </select>
      <div className="mrow">
        <div><label>Preferred doctor</label><select value={f.doctor_id} onChange={set('doctor_id')}>
          <option value="">Any</option>{doctors.map(d => <option key={d.id} value={d.id}>{d.full_name}</option>)}</select></div>
        <div><label>Treatment</label><select value={f.treatment_id} onChange={set('treatment_id')}>
          <option value="">—</option>{treatments.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></div>
      </div>
      <label>Notes</label><input placeholder="Any morning slot, weekends only…" value={f.notes} onChange={set('notes')} />
      <button className="btn" onClick={save}>Add to waitlist</button>
    </Modal>
  )
}
