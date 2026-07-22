import { useEffect, useState } from 'react'
import { sb } from '../lib/supabase'
import { fmtD, today } from '../lib/format'
import { useToast } from '../components/Toast'
import Modal from '../components/Modal'
import ConfirmDialog from '../components/ConfirmDialog'

const TYPES = [['', 'All'], ['biomedical_waste', 'Biomedical Waste'], ['equipment_maintenance', 'Equipment Maintenance'], ['sterilization', 'Sterilization']]
const TYPE_LABELS = { biomedical_waste: 'BMW', equipment_maintenance: 'Equipment', sterilization: 'Sterilization' }

export default function ComplianceLogs() {
  const [rows, setRows] = useState(null)
  const [type, setType] = useState('')
  const [show, setShow] = useState(false)
  const [confirmDel, setConfirmDel] = useState(null)
  const toast = useToast()

  async function load() {
    const { data, error } = await sb.from('compliance_logs').select('*, staff(full_name)').order('log_date', { ascending: false }).limit(300)
    if (error) { toast('Error: ' + error.message); return setRows([]) }
    setRows(data)
  }
  useEffect(() => { load() }, [])

  async function remove(id) {
    const { error } = await sb.from('compliance_logs').delete().eq('id', id)
    if (error) return toast('Error: ' + error.message)
    toast('Entry deleted'); load()
  }

  if (!rows) return <div className="empty">Loading…</div>
  const view = rows.filter(r => !type || r.log_type === type)
  const t = today()

  return (
    <>
      <div className="pagehead">
        <h2>Compliance logs</h2>
        <button className="btn" onClick={() => setShow(true)}>+ New entry</button>
      </div>
      <p style={{ fontSize: '.74rem', color: 'var(--mid)', marginBottom: '1rem' }}>
        Biomedical waste disposal, equipment maintenance, and sterilization cycle records.
      </p>
      <div className="bar">
        <select value={type} onChange={e => setType(e.target.value)}>
          {TYPES.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
        </select>
      </div>
      {!view.length ? <div className="empty">No entries yet.</div> : (
        <table className="tbl">
          <thead><tr><th>Type</th><th>Item</th><th>Date</th><th>Result</th><th>Next due</th><th>Vendor</th><th>By</th><th></th></tr></thead>
          <tbody>{view.map(r => {
            const overdue = r.next_due_date && r.next_due_date <= t
            return (
              <tr key={r.id}>
                <td>{TYPE_LABELS[r.log_type] || r.log_type}</td>
                <td>{r.item_name}</td>
                <td>{fmtD(r.log_date)}</td>
                <td>{r.indicator_result ? <span className={'badge ' + (r.indicator_result === 'pass' ? 'b-paid' : 'b-fail')}>{r.indicator_result}</span> : '—'}</td>
                <td className={overdue ? 'low' : ''}>{r.next_due_date ? fmtD(r.next_due_date) : '—'}{overdue && ' · DUE'}</td>
                <td>{r.vendor || '—'}</td>
                <td>{r.staff?.full_name || '—'}</td>
                <td><button className="btn sm ghost danger" onClick={() => setConfirmDel(r.id)}>Delete</button></td>
              </tr>
            )
          })}</tbody>
        </table>
      )}
      {show && <LogForm onClose={() => setShow(false)} onDone={() => { setShow(false); load() }} />}
      {confirmDel && <ConfirmDialog title="Delete this entry?" onCancel={() => setConfirmDel(null)}
        onConfirm={() => { remove(confirmDel); setConfirmDel(null) }} />}
    </>
  )
}

function LogForm({ onClose, onDone }) {
  const [staff, setStaff] = useState([])
  const [f, setF] = useState({
    log_type: 'biomedical_waste', item_name: '', log_date: today(), next_due_date: '',
    performed_by: '', vendor: '', notes: '', indicator_result: '',
  })
  const toast = useToast()
  const set = k => e => setF(x => ({ ...x, [k]: e.target.value }))

  useEffect(() => {
    sb.from('staff').select('*').eq('active', true).order('full_name').then(({ data }) => setStaff(data ?? []))
  }, [])

  async function save() {
    if (!f.item_name.trim()) return toast('Item name required.')
    const { error } = await sb.from('compliance_logs').insert({
      log_type: f.log_type, item_name: f.item_name.trim(), log_date: f.log_date || null,
      next_due_date: f.next_due_date || null, performed_by: f.performed_by || null,
      vendor: f.vendor.trim() || null, notes: f.notes.trim() || null,
      indicator_result: f.log_type === 'sterilization' ? (f.indicator_result || null) : null,
    })
    if (error) return toast('Error: ' + error.message)
    toast('Entry logged'); onDone()
  }

  const placeholders = {
    biomedical_waste: 'Sharps disposal, Yellow bag pickup…',
    equipment_maintenance: 'Autoclave #1, X-ray unit…',
    sterilization: 'Autoclave #1, Load 3…',
  }

  return (
    <Modal title="New compliance entry" onClose={onClose}>
      <label>Type</label>
      <select value={f.log_type} onChange={set('log_type')}>
        <option value="biomedical_waste">Biomedical Waste</option>
        <option value="equipment_maintenance">Equipment Maintenance</option>
        <option value="sterilization">Sterilization Cycle</option>
      </select>
      <label>Item name *</label>
      <input placeholder={placeholders[f.log_type]} value={f.item_name} onChange={set('item_name')} />
      {f.log_type === 'sterilization' && (
        <>
          <label>Indicator result</label>
          <select value={f.indicator_result} onChange={set('indicator_result')}>
            <option value="">—</option><option value="pass">Pass</option><option value="fail">Fail</option>
          </select>
        </>
      )}
      <div className="mrow">
        <div><label>Date</label><input type="date" value={f.log_date} onChange={set('log_date')} /></div>
        <div><label>Next due (optional)</label><input type="date" value={f.next_due_date} onChange={set('next_due_date')} /></div>
      </div>
      <div className="mrow">
        <div><label>Performed by</label><select value={f.performed_by} onChange={set('performed_by')}>
          <option value="">—</option>{staff.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}</select></div>
        <div><label>Vendor / agency</label><input value={f.vendor} onChange={set('vendor')} /></div>
      </div>
      <label>Notes</label><input value={f.notes} onChange={set('notes')} />
      <button className="btn" onClick={save}>Save entry</button>
    </Modal>
  )
}
