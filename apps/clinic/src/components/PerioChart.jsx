import { useEffect, useState } from 'react'
import { sb } from '../lib/supabase'
import { fmtD, today } from '../lib/format'
import { useToast } from './Toast'
import Modal from './Modal'

const MOBILITY_LABELS = ['0 — none', '1 — slight', '2 — moderate', '3 — severe']

export default function PerioChart({ patientId }) {
  const [rows, setRows] = useState(null)
  const [show, setShow] = useState(false)
  const [detail, setDetail] = useState(null) // exam id
  const toast = useToast()

  async function load() {
    const { data, error } = await sb.from('periodontal_exams').select('*, staff(full_name)')
      .eq('patient_id', patientId).order('exam_date', { ascending: false })
    if (error) { toast('Error: ' + error.message); return setRows([]) }
    setRows(data ?? [])
  }
  useEffect(() => { load() }, [patientId])

  if (!rows) return <div className="empty">Loading…</div>
  return (
    <>
      <button className="btn" style={{ marginBottom: '.75rem' }} onClick={() => setShow(true)}>+ New perio exam</button>
      {!rows.length ? <div className="empty">No periodontal exams recorded.</div> : (
        <table className="tbl">
          <thead><tr><th>Date</th><th>Performed by</th><th>Notes</th><th></th></tr></thead>
          <tbody>{rows.map(e => (
            <tr key={e.id}>
              <td>{fmtD(e.exam_date)}</td><td>{e.staff?.full_name || '—'}</td><td>{e.notes || '—'}</td>
              <td><button className="btn sm ghost" onClick={() => setDetail(e.id)}>View readings</button></td>
            </tr>
          ))}</tbody>
        </table>
      )}
      {show && <ExamForm patientId={patientId} onClose={() => setShow(false)} onDone={() => { setShow(false); load() }} />}
      {detail && <ExamDetail id={detail} onClose={() => setDetail(null)} />}
    </>
  )
}

function ExamForm({ patientId, onClose, onDone }) {
  const [staff, setStaff] = useState([])
  const [f, setF] = useState({ exam_date: today(), performed_by: '', notes: '' })
  const [readings, setReadings] = useState([])
  const [showReading, setShowReading] = useState(false)
  const toast = useToast()
  const set = k => e => setF(x => ({ ...x, [k]: e.target.value }))

  useEffect(() => {
    sb.from('staff').select('*').eq('active', true).order('full_name').then(({ data }) => setStaff(data ?? []))
  }, [])

  function addReading(r) { setReadings(x => [...x, r]); setShowReading(false) }
  function removeReading(i) { setReadings(x => x.filter((_, idx) => idx !== i)) }

  async function save() {
    const { data: exam, error } = await sb.from('periodontal_exams').insert({
      patient_id: patientId, exam_date: f.exam_date || null, performed_by: f.performed_by || null, notes: f.notes.trim() || null,
    }).select().single()
    if (error) return toast('Error: ' + error.message)
    if (readings.length) {
      const recs = readings.map(r => ({ ...r, exam_id: exam.id }))
      const { error: rErr } = await sb.from('periodontal_readings').insert(recs)
      if (rErr) return toast('Error: ' + rErr.message)
    }
    toast('Perio exam saved'); onDone()
  }

  return (
    <Modal title="New periodontal exam" onClose={onClose}>
      <div className="mrow">
        <div><label>Exam date</label><input type="date" value={f.exam_date} onChange={set('exam_date')} /></div>
        <div><label>Performed by</label><select value={f.performed_by} onChange={set('performed_by')}>
          <option value="">—</option>{staff.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}</select></div>
      </div>
      <label>Notes</label><input value={f.notes} onChange={set('notes')} />

      <label style={{ marginTop: '1rem' }}>Tooth readings ({readings.length})</label>
      {readings.length > 0 && (
        <table className="tbl" style={{ marginBottom: '.5rem' }}>
          <thead><tr><th>Tooth</th><th>Buccal</th><th>Lingual</th><th>Recession</th><th>BOP</th><th>Mob.</th><th></th></tr></thead>
          <tbody>{readings.map((r, i) => (
            <tr key={i}>
              <td>{r.tooth_number}</td><td>{r.pocket_depth_buccal ?? '—'}</td><td>{r.pocket_depth_lingual ?? '—'}</td>
              <td>{r.recession ?? '—'}</td><td>{r.bleeding_on_probing ? 'Yes' : 'No'}</td><td>{r.mobility ?? '—'}</td>
              <td><button className="btn sm ghost danger" onClick={() => removeReading(i)}>Remove</button></td>
            </tr>
          ))}</tbody>
        </table>
      )}
      <button type="button" className="btn sm ghost" onClick={() => setShowReading(true)}>+ Add tooth reading</button>

      <button className="btn" style={{ marginTop: '1.25rem' }} onClick={save}>Save exam</button>
      {showReading && <ReadingForm onClose={() => setShowReading(false)} onAdd={addReading} />}
    </Modal>
  )
}

function ReadingForm({ onClose, onAdd }) {
  const [f, setF] = useState({ tooth_number: '', pocket_depth_buccal: '', pocket_depth_lingual: '', recession: '', bleeding_on_probing: false, mobility: '' })
  const toast = useToast()
  const set = k => e => setF(x => ({ ...x, [k]: e.target.value }))

  function add() {
    const n = parseInt(f.tooth_number)
    if (!n || n < 1 || n > 32) return toast('Enter a valid tooth number (1–32).')
    onAdd({
      tooth_number: n,
      pocket_depth_buccal: parseFloat(f.pocket_depth_buccal) || null,
      pocket_depth_lingual: parseFloat(f.pocket_depth_lingual) || null,
      recession: parseFloat(f.recession) || null,
      bleeding_on_probing: f.bleeding_on_probing,
      mobility: f.mobility === '' ? null : parseInt(f.mobility),
    })
  }

  return (
    <Modal title="Add tooth reading" onClose={onClose}>
      <label>Tooth number (1–32) *</label><input type="number" min="1" max="32" value={f.tooth_number} onChange={set('tooth_number')} />
      <div className="mrow">
        <div><label>Pocket depth — buccal (mm)</label><input type="number" step="0.5" value={f.pocket_depth_buccal} onChange={set('pocket_depth_buccal')} /></div>
        <div><label>Pocket depth — lingual (mm)</label><input type="number" step="0.5" value={f.pocket_depth_lingual} onChange={set('pocket_depth_lingual')} /></div>
      </div>
      <div className="mrow">
        <div><label>Recession (mm)</label><input type="number" step="0.5" value={f.recession} onChange={set('recession')} /></div>
        <div><label>Mobility</label><select value={f.mobility} onChange={set('mobility')}>
          <option value="">—</option>{MOBILITY_LABELS.map((l, i) => <option key={i} value={i}>{l}</option>)}</select></div>
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: '.5rem', textTransform: 'none', fontSize: '.78rem', color: 'var(--ink)' }}>
        <input type="checkbox" style={{ width: 'auto' }} checked={f.bleeding_on_probing}
          onChange={e => setF(x => ({ ...x, bleeding_on_probing: e.target.checked }))} /> Bleeding on probing
      </label>
      <button className="btn" onClick={add}>Add reading</button>
    </Modal>
  )
}

function ExamDetail({ id, onClose }) {
  const [exam, setExam] = useState(null)
  const [readings, setReadings] = useState(null)
  const toast = useToast()

  useEffect(() => {
    sb.from('periodontal_exams').select('*, staff(full_name)').eq('id', id).single().then(({ data }) => setExam(data))
    sb.from('periodontal_readings').select('*').eq('exam_id', id).order('tooth_number').then(({ data, error }) => {
      if (error) toast('Error: ' + error.message)
      setReadings(data ?? [])
    })
  }, [id])

  if (!exam || !readings) return null
  return (
    <Modal title={'Perio exam — ' + fmtD(exam.exam_date)} onClose={onClose}>
      <p style={{ fontSize: '.78rem', color: 'var(--mid)', marginBottom: '.75rem' }}>
        {exam.staff?.full_name ? 'By ' + exam.staff.full_name : ''}{exam.notes ? ' · ' + exam.notes : ''}
      </p>
      {!readings.length ? <div className="empty">No tooth readings recorded for this exam.</div> : (
        <table className="tbl">
          <thead><tr><th>Tooth</th><th>Buccal</th><th>Lingual</th><th>Recession</th><th>BOP</th><th>Mobility</th></tr></thead>
          <tbody>{readings.map(r => (
            <tr key={r.id}>
              <td>{r.tooth_number}</td><td>{r.pocket_depth_buccal ?? '—'}</td><td>{r.pocket_depth_lingual ?? '—'}</td>
              <td>{r.recession ?? '—'}</td><td className={r.bleeding_on_probing ? 'low' : ''}>{r.bleeding_on_probing ? 'Yes' : 'No'}</td>
              <td>{r.mobility ?? '—'}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
    </Modal>
  )
}
