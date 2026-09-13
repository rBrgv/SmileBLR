import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { fmtT, today } from '../lib/format'
import { useToast } from '../components/Toast'
import Modal from '../components/Modal'
import StatusSelect from '../components/StatusSelect'
import VoiceNote from '../components/VoiceNote'
import ConfirmDialog from '../components/ConfirmDialog'
import CancelReasonDialog from '../components/CancelReasonDialog'

export const APPT_STATUSES = ['scheduled', 'confirmed', 'in_progress', 'completed', 'cancelled', 'no_show']

// Marking a visit completed schedules the next recall automatically, using
// the patient's own recall interval (defaults to 6 months; perio-maintenance
// patients are often set to 3).
export async function completeAppointment(patientId) {
  const { data: patient } = await sb.from('patients').select('recall_interval_months').eq('id', patientId).maybeSingle()
  const due = new Date(); due.setMonth(due.getMonth() + (patient?.recall_interval_months || 6))
  await sb.from('recall_reminders').insert({
    patient_id: patientId, last_visit_date: today(), recall_due_date: due.toISOString().slice(0, 10),
  })
}

export function AppointmentForm({ patientId, defaultDate, onDone, onClose }) {
  const [patients, setPatients] = useState([])
  const [doctors, setDoctors] = useState([])
  const [treatments, setTreatments] = useState([])
  const [f, setF] = useState({ patient_id: patientId || '', date: defaultDate || today(), time: '10:00', doctor_id: '', treatment_id: '', floor_room: '', duration: 30, notes: '', repeat: false, repeatFreq: 'weekly', repeatCount: 4 })
  const [conflict, setConflict] = useState(null)
  const [allergies, setAllergies] = useState(null)
  const toast = useToast()

  useEffect(() => {
    sb.from('patients').select('id,full_name,phone').order('full_name').then(({ data }) => {
      setPatients(data ?? [])
      if (!patientId && data?.length) setF(x => ({ ...x, patient_id: data[0].id }))
    })
    sb.from('staff').select('*').eq('active', true).eq('role', 'doctor').order('full_name').then(({ data }) => setDoctors(data ?? []))
    sb.from('treatments').select('*').order('name').then(({ data }) => setTreatments(data ?? []))
  }, [])

  useEffect(() => {
    if (!f.patient_id) return setAllergies(null)
    sb.from('medical_history').select('allergies').eq('patient_id', f.patient_id).order('updated_at', { ascending: false }).limit(1)
      .then(({ data }) => setAllergies(data?.[0]?.allergies || null))
  }, [f.patient_id])

  async function doInsert() {
    const base = {
      patient_id: f.patient_id, doctor_id: f.doctor_id || null, treatment_id: f.treatment_id || null,
      floor_room: f.floor_room.trim() || null, duration_minutes: parseInt(f.duration) || 30, notes: f.notes.trim() || null,
    }
    if (f.repeat && parseInt(f.repeatCount) > 1) {
      const groupId = crypto.randomUUID()
      const stepDays = { weekly: 7, biweekly: 14 }[f.repeatFreq]
      const rows = Array.from({ length: parseInt(f.repeatCount) }, (_, i) => {
        const d = new Date(f.date + 'T00:00:00')
        if (f.repeatFreq === 'monthly') d.setMonth(d.getMonth() + i)
        else d.setDate(d.getDate() + i * stepDays)
        const dateStr = d.toISOString().slice(0, 10)
        return { ...base, appointment_time: new Date(dateStr + 'T' + f.time + ':00').toISOString(), recurrence_group_id: groupId }
      })
      const { error } = await sb.from('appointments').insert(rows)
      if (error) return toast('Error: ' + error.message)
      toast(`${rows.length} appointments created (only the first was checked for conflicts)`); onDone()
      return
    }
    const { error } = await sb.from('appointments').insert({ ...base, appointment_time: new Date(f.date + 'T' + f.time + ':00').toISOString() })
    if (error) return toast('Error: ' + error.message)
    toast('Appointment created'); onDone()
  }

  async function save() {
    if (!f.patient_id) return toast('Pick a patient.')
    if (f.doctor_id) {
      const doctorName = doctors.find(d => d.id === f.doctor_id)?.full_name || 'This doctor'
      const { data: onLeave } = await sb.from('staff_leave').select('reason').eq('staff_id', f.doctor_id).eq('leave_date', f.date).maybeSingle()
      if (onLeave) {
        setConflict(`${doctorName} is on leave that day${onLeave.reason ? ' (' + onLeave.reason + ')' : ''}. Book this anyway?`)
        return
      }
      const start = new Date(f.date + 'T' + f.time + ':00')
      const end = new Date(start.getTime() + (parseInt(f.duration) || 30) * 60000)
      const dayStart = new Date(f.date + 'T00:00:00'), dayEnd = new Date(dayStart); dayEnd.setDate(dayEnd.getDate() + 1)
      const { data: existing } = await sb.from('appointments')
        .select('appointment_time, duration_minutes, patients(full_name)')
        .eq('doctor_id', f.doctor_id)
        .gte('appointment_time', dayStart.toISOString()).lt('appointment_time', dayEnd.toISOString())
        .not('status', 'in', '("cancelled","no_show")')
      const clash = (existing ?? []).find(a => {
        const aStart = new Date(a.appointment_time)
        const aEnd = new Date(aStart.getTime() + (a.duration_minutes || 30) * 60000)
        return start < aEnd && end > aStart
      })
      if (clash) {
        setConflict(`${doctorName} already has ${clash.patients?.full_name || 'another patient'} booked at ${fmtT(clash.appointment_time)}. Book this anyway?`)
        return
      }
    }
    if (f.floor_room.trim()) {
      const start = new Date(f.date + 'T' + f.time + ':00')
      const end = new Date(start.getTime() + (parseInt(f.duration) || 30) * 60000)
      const dayStart = new Date(f.date + 'T00:00:00'), dayEnd = new Date(dayStart); dayEnd.setDate(dayEnd.getDate() + 1)
      const { data: inRoom } = await sb.from('appointments')
        .select('appointment_time, duration_minutes, floor_room, patients(full_name)')
        .ilike('floor_room', f.floor_room.trim())
        .gte('appointment_time', dayStart.toISOString()).lt('appointment_time', dayEnd.toISOString())
        .not('status', 'in', '("cancelled","no_show")')
      const roomClash = (inRoom ?? []).find(a => {
        const aStart = new Date(a.appointment_time)
        const aEnd = new Date(aStart.getTime() + (a.duration_minutes || 30) * 60000)
        return start < aEnd && end > aStart
      })
      if (roomClash) {
        setConflict(`${f.floor_room} is already booked for ${roomClash.patients?.full_name || 'another patient'} at ${fmtT(roomClash.appointment_time)}. Book this anyway?`)
        return
      }
    }
    doInsert()
  }

  const set = k => e => setF(x => ({ ...x, [k]: e.target.value }))
  return (
    <>
    <Modal title="New appointment" onClose={onClose}>
      <label>Patient *</label>
      <select value={f.patient_id} onChange={set('patient_id')}>
        {patients.map(p => <option key={p.id} value={p.id}>{p.full_name} · {p.phone}</option>)}
      </select>
      {allergies && <div className="allergy-alert" style={{ marginBottom: '1rem' }}>⚠ Allergy: {allergies}</div>}
      <div className="mrow">
        <div><label>Date *</label><input type="date" value={f.date} onChange={set('date')} /></div>
        <div><label>Time *</label><input type="time" value={f.time} onChange={set('time')} /></div>
      </div>
      <div className="mrow">
        <div><label>Doctor</label><select value={f.doctor_id} onChange={set('doctor_id')}>
          <option value="">—</option>{doctors.map(d => <option key={d.id} value={d.id}>{d.full_name}</option>)}</select></div>
        <div><label>Treatment</label><select value={f.treatment_id} onChange={e => {
          const tid = e.target.value
          const picked = treatments.find(t => t.id === tid)
          setF(x => ({ ...x, treatment_id: tid, duration: picked?.typical_duration_minutes || x.duration }))
        }}>
          <option value="">—</option>{treatments.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></div>
      </div>
      <div className="mrow">
        <div><label>Floor / room</label><input placeholder="Floor 2, Room 1" value={f.floor_room} onChange={set('floor_room')} /></div>
        <div><label>Duration (min)</label><input type="number" value={f.duration} onChange={set('duration')} /></div>
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: '.5rem', textTransform: 'none', fontSize: '.78rem', color: 'var(--ink)' }}>
        <input type="checkbox" style={{ width: 'auto' }} checked={f.repeat} onChange={e => setF(x => ({ ...x, repeat: e.target.checked }))} /> Repeat this appointment
      </label>
      {f.repeat && (
        <div className="mrow">
          <div><label>Frequency</label><select value={f.repeatFreq} onChange={set('repeatFreq')}>
            <option value="weekly">Weekly</option><option value="biweekly">Every 2 weeks</option><option value="monthly">Monthly</option>
          </select></div>
          <div><label>Number of visits</label><input type="number" min="2" max="24" value={f.repeatCount} onChange={set('repeatCount')} /></div>
        </div>
      )}
      <label>Notes</label>
      <VoiceNote value={f.notes} onChange={v => setF(x => ({ ...x, notes: v }))} rows={2} />
      <button className="btn" onClick={save}>Save appointment</button>
    </Modal>
    {conflict && <ConfirmDialog title="Scheduling conflict" body={conflict} confirmLabel="Book anyway"
      onCancel={() => setConflict(null)} onConfirm={() => { setConflict(null); doInsert() }} />}
    </>
  )
}

function weekStart(dateStr) {
  const d = new Date(dateStr + 'T00:00:00')
  const day = d.getDay() // 0=Sun..6=Sat
  d.setDate(d.getDate() - ((day + 6) % 7)) // back to Monday
  return d
}

export default function Appointments() {
  const [date, setDate] = useState(today())
  const [view, setView] = useState('day') // 'day' | 'week'
  const [rows, setRows] = useState(null)
  const [doctors, setDoctors] = useState([])
  const [doctorFilter, setDoctorFilter] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [reasonPrompt, setReasonPrompt] = useState(null) // {a, status}
  const toast = useToast()
  const nav = useNavigate()

  async function load() {
    let from, to
    if (view === 'week') {
      from = weekStart(date)
      to = new Date(from); to.setDate(to.getDate() + 7)
    } else {
      from = new Date(date + 'T00:00:00')
      to = new Date(from); to.setDate(to.getDate() + 1)
    }
    const { data, error } = await sb.from('appointments')
      .select('*, patients(full_name,phone), staff(full_name), treatments(name)')
      .gte('appointment_time', from.toISOString()).lt('appointment_time', to.toISOString())
      .order('appointment_time')
    if (error) return toast('Error: ' + error.message)
    setRows(data)
  }
  useEffect(() => { load() }, [date, view])
  useEffect(() => {
    sb.from('staff').select('id,full_name').eq('active', true).eq('role', 'doctor').order('full_name').then(({ data }) => setDoctors(data ?? []))
  }, [])

  async function setStatus(a, status, reason = null) {
    const rec = { status }
    if (reason !== null) rec.status_reason = reason
    const { error } = await sb.from('appointments').update(rec).eq('id', a.id)
    if (error) return toast('Error: ' + error.message)
    if (status === 'completed') { await completeAppointment(a.patient_id); toast('Visit completed · recall scheduled') }
    else toast('Appointment ' + status.replace('_', ' '))
    load()
  }

  function onStatusChange(a, status) {
    if (status === 'cancelled' || status === 'no_show') setReasonPrompt({ a, status })
    else setStatus(a, status)
  }

  async function cancelSeries(groupId) {
    const { error } = await sb.from('appointments').update({ status: 'cancelled', status_reason: 'Recurring series ended' })
      .eq('recurrence_group_id', groupId).gte('appointment_time', new Date().toISOString())
      .not('status', 'in', '("completed","cancelled")')
    if (error) return toast('Error: ' + error.message)
    toast('Remaining series cancelled'); load()
  }

  const view_ = view === 'week' ? rows : (rows || []).filter(a => !doctorFilter || a.doctor_id === doctorFilter)

  return (
    <>
      <div className="pagehead">
        <h2>Appointments</h2>
        <div>
          {view === 'day' && <a className="btn ghost" target="_blank" rel="noreferrer" href={'/print/day/' + date}>Print day</a>}{' '}
          <button className="btn" onClick={() => setShowForm(true)}>+ New appointment</button>
        </div>
      </div>
      <div className="bar">
        <input type="date" style={{ maxWidth: 180 }} value={date} onChange={e => setDate(e.target.value)} />
        <select style={{ width: 'auto' }} value={view} onChange={e => setView(e.target.value)}>
          <option value="day">Day view</option>
          <option value="week">Week view</option>
        </select>
        <select style={{ width: 'auto' }} value={doctorFilter} onChange={e => setDoctorFilter(e.target.value)}>
          <option value="">All doctors</option>
          {doctors.map(d => <option key={d.id} value={d.id}>{d.full_name}</option>)}
        </select>
      </div>
      {!rows ? <div className="empty">Loading…</div> : view === 'week' ? (
        <WeekGrid rows={rows} weekFrom={weekStart(date)} onPickDay={d => { setDate(d); setView('day') }} doctorFilter={doctorFilter} />
      ) : !view_.length ? <div className="empty">No appointments on this day.</div> : (
        <table className="tbl">
          <thead><tr><th>Time</th><th>Patient</th><th>Doctor</th><th>Treatment</th><th>Room</th><th>Status</th></tr></thead>
          <tbody>{view_.map(a => (
            <tr key={a.id}>
              <td>{fmtT(a.appointment_time)}</td>
              <td className="link" onClick={() => nav('/patients/' + a.patient_id)}>{a.patients?.full_name}</td>
              <td>{a.staff?.full_name || '—'}</td>
              <td>{a.treatments?.name || '—'}</td>
              <td>{a.floor_room || '—'}</td>
              <td>
                <StatusSelect value={a.status} options={APPT_STATUSES} onChange={s => onStatusChange(a, s)} />
                {a.status_reason && <div style={{ fontSize: '.66rem', color: 'var(--soft)', marginTop: '.2rem' }}>{a.status_reason}</div>}
                {a.recurrence_group_id && <button className="btn sm ghost" style={{ marginTop: '.3rem' }} onClick={() => cancelSeries(a.recurrence_group_id)}>Cancel remaining series</button>}
              </td>
            </tr>
          ))}</tbody>
        </table>
      )}
      {showForm && <AppointmentForm defaultDate={date} onClose={() => setShowForm(false)} onDone={() => { setShowForm(false); load() }} />}
      {reasonPrompt && (
        <CancelReasonDialog status={reasonPrompt.status} onCancel={() => setReasonPrompt(null)}
          onConfirm={reason => { setStatus(reasonPrompt.a, reasonPrompt.status, reason); setReasonPrompt(null) }} />
      )}
    </>
  )
}

function WeekGrid({ rows, weekFrom, onPickDay, doctorFilter }) {
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekFrom); d.setDate(d.getDate() + i)
    return d
  })
  // Local calendar date, not toISOString() — that round-trips through UTC and
  // rolls a local-midnight Date object back a day in any timezone ahead of
  // UTC (e.g. IST), which was shifting every appointment into the next day's column.
  const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
  const byDay = {}
  rows.filter(a => !doctorFilter || a.doctor_id === doctorFilter).forEach(a => {
    const k = a.appointment_time.slice(0, 10)
    ;(byDay[k] ||= []).push(a)
  })
  const isToday = d => iso(d) === today()

  return (
    <div className="week-grid">
      {days.map(d => (
        <div key={iso(d)} className={'week-day' + (isToday(d) ? ' is-today' : '')}>
          <div className="week-day-head" onClick={() => onPickDay(iso(d))}>
            {d.toLocaleDateString('en-IN', { weekday: 'short' })}<br />
            <b>{d.getDate()}</b>
          </div>
          <div className="week-day-body">
            {(byDay[iso(d)] || []).length === 0
              ? <div className="week-empty">—</div>
              : byDay[iso(d)].map(a => (
                <div key={a.id} className={'week-appt wk-' + a.status}>
                  <b>{fmtT(a.appointment_time)}</b> {a.patients?.full_name}
                  <div className="week-appt-sub">{a.staff?.full_name || '—'}</div>
                </div>
              ))}
          </div>
        </div>
      ))}
    </div>
  )
}
