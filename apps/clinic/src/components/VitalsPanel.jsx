import { useEffect, useRef, useState } from 'react'
import { sb } from '../lib/supabase'
import { fmtD, today } from '../lib/format'
import { canRecordVitals, vitalsSummary } from '../lib/vitals'
import { useRole } from '../lib/RoleContext'
import { useToast } from './Toast'
import Modal from './Modal'

const FIELDS = [
  ['bp_systolic', 'BP systolic (mmHg)', 50, 300, 1],
  ['bp_diastolic', 'BP diastolic (mmHg)', 20, 200, 1],
  ['pulse', 'Pulse (per min)', 20, 250, 1],
  ['temperature_f', 'Temperature (°F)', 90, 110, 0.1],
  ['spo2', 'SpO₂ (%)', 50, 100, 1],
  ['blood_sugar', 'Blood sugar (mg/dL)', 20, 800, 0.1],
  ['weight_kg', 'Weight (kg)', 1, 400, 0.1],
]

export default function VitalsPanel({ patientId }) {
  const [rows, setRows] = useState(null)
  const [form, setForm] = useState(null) // {} for new, the row for an edit
  const toast = useToast()
  const allowed = canRecordVitals(useRole())

  async function load() {
    const { data, error } = await sb.from('patient_vitals').select('*, staff(full_name)')
      .eq('patient_id', patientId).order('recorded_on', { ascending: false }).order('created_at', { ascending: false })
    if (error) { toast('Error: ' + error.message); return setRows([]) }
    setRows(data ?? [])
  }
  useEffect(() => { load() }, [patientId])

  if (!rows) return <div className="empty">Loading…</div>
  return (
    <>
      <h4 style={{ fontSize: '.8rem', marginBottom: '.5rem' }}>Vitals</h4>
      <button className="btn sm" style={{ marginBottom: '.75rem' }} disabled={!allowed}
        title={allowed ? undefined : 'Doctor, admin or assistant access required'}
        onClick={() => setForm({})}>+ Record vitals</button>
      {!rows.length ? <div className="empty">No vitals recorded.</div> : (
        <table className="tbl" style={{ marginBottom: '1.5rem' }}>
          <thead><tr><th>Date</th><th>BP</th><th>Pulse</th><th>Temp</th><th>SpO₂</th><th>Sugar</th><th>Weight</th><th>Recorded by</th><th></th></tr></thead>
          <tbody>{rows.map(v => {
            const s = vitalsSummary(v)
            return (
              <tr key={v.id}>
                <td>{fmtD(v.recorded_on)}</td>
                <td>{s.bp}</td><td>{s.pulse}</td><td>{s.temperature}</td><td>{s.spo2}</td><td>{s.sugar}</td><td>{s.weight}</td>
                <td>{v.staff?.full_name || '—'}{v.notes ? <><br /><span style={{ color: 'var(--soft)' }}>{v.notes}</span></> : null}</td>
                <td>{allowed && <button className="btn sm ghost" onClick={() => setForm(v)}>Edit</button>}</td>
              </tr>
            )
          })}</tbody>
        </table>
      )}
      {form && <VitalsForm patientId={patientId} row={form.id ? form : null}
        onClose={() => setForm(null)} onDone={() => { setForm(null); load() }} />}
    </>
  )
}

function VitalsForm({ patientId, row, onClose, onDone }) {
  const [f, setF] = useState(() => ({
    recorded_on: row?.recorded_on || today(),
    sugar_timing: row?.sugar_timing || '',
    notes: row?.notes || '',
    ...Object.fromEntries(FIELDS.map(([k]) => [k, row?.[k] ?? ''])),
  }))
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const toast = useToast()
  const set = k => e => setF(x => ({ ...x, [k]: e.target.value }))

  async function save(e) {
    e.preventDefault()
    if (lock.current) return
    const values = Object.fromEntries(FIELDS.map(([k]) => [k, f[k] === '' ? null : Number(f[k])]))
    if (FIELDS.every(([k]) => values[k] == null)) return toast('Enter at least one reading.')
    if ((values.bp_systolic == null) !== (values.bp_diastolic == null)) return toast('Enter both blood pressure numbers.')
    lock.current = true; setBusy(true)
    try {
      const record = {
        ...values, recorded_on: f.recorded_on,
        sugar_timing: values.blood_sugar == null ? null : (f.sugar_timing || null),
        notes: f.notes.trim() || null,
      }
      const { error } = row
        ? await sb.from('patient_vitals').update(record).eq('id', row.id)
        : await sb.from('patient_vitals').insert({ patient_id: patientId, ...record })
      if (error) throw error
      toast(row ? 'Vitals updated' : 'Vitals recorded'); onDone()
    } catch (e) { toast(e.message) } finally { lock.current = false; setBusy(false) }
  }

  return (
    <Modal title={row ? 'Edit vitals' : 'Record vitals'} onClose={() => !busy && onClose()}>
      <form onSubmit={save}>
        <label>Date<input type="date" required max={today()} value={f.recorded_on} onChange={set('recorded_on')} /></label>
        {FIELDS.map(([k, label, min, max, step]) => (
          <label key={k}>{label}<input type="number" min={min} max={max} step={step} value={f[k]} onChange={set(k)} /></label>
        ))}
        {f.blood_sugar !== '' && (
          <label>Sugar reading taken
            <select value={f.sugar_timing} onChange={set('sugar_timing')}>
              <option value="">—</option>
              <option value="fasting">fasting</option>
              <option value="post_prandial">post prandial</option>
              <option value="random">random</option>
            </select>
          </label>
        )}
        <label>Notes<textarea value={f.notes} onChange={set('notes')} /></label>
        <p>Leave a box empty if that reading was not taken.</p>
        <button className="btn" type="submit" disabled={busy}>{busy ? 'Saving…' : row ? 'Save changes' : 'Save vitals'}</button>
      </form>
    </Modal>
  )
}
