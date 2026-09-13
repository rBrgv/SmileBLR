import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { fmtD, inr, today } from '../lib/format'
import { useToast } from '../components/Toast'
import Modal from '../components/Modal'
import StatusSelect from '../components/StatusSelect'
import ConfirmDialog from '../components/ConfirmDialog'

export const CLAIM_STATUSES = ['submitted', 'under_review', 'approved', 'rejected', 'paid']
const TYPE_FILTERS = [['', 'All types'], ['pre_authorization', 'Pre-Authorization'], ['claim', 'Claim']]

export default function InsuranceClaims() {
  const [rows, setRows] = useState(null)
  const [q, setQ] = useState('')
  const [st, setSt] = useState('')
  const [ct, setCt] = useState('')
  const [show, setShow] = useState(false)
  const [fileFrom, setFileFrom] = useState(null) // approved pre-auth being filed as a claim
  const [confirmDel, setConfirmDel] = useState(null)
  const toast = useToast()
  const nav = useNavigate()

  async function load() {
    const { data, error } = await sb.from('insurance_claims').select('*, patients(id,full_name)')
      .is('deleted_at', null).order('submitted_date', { ascending: false }).limit(300)
    if (error) { toast('Error: ' + error.message); return setRows([]) }
    setRows(data)
  }
  useEffect(() => { load() }, [])

  async function setStatus(id, status) {
    const rec = { status }
    if (status === 'approved' || status === 'rejected' || status === 'paid') rec.resolved_date = today()
    const { error } = await sb.from('insurance_claims').update(rec).eq('id', id)
    if (error) return toast('Error: ' + error.message)
    toast('Claim ' + status.replace('_', ' ')); load()
  }

  async function remove(id) {
    const { error } = await sb.from('insurance_claims').update({ deleted_at: new Date().toISOString() }).eq('id', id)
    if (error) return toast('Error: ' + error.message)
    toast('Moved to trash', { actionLabel: 'Undo', onAction: async () => { await sb.from('insurance_claims').update({ deleted_at: null }).eq('id', id); load() } })
    load()
  }

  if (!rows) return <div className="empty">Loading…</div>
  const view = rows.filter(c =>
    (!q || (c.patients?.full_name || '').toLowerCase().includes(q.toLowerCase())) &&
    (!st || c.status === st) && (!ct || (c.claim_type || 'claim') === ct))

  return (
    <>
      <div className="pagehead">
        <h2>Insurance claims</h2>
        <button className="btn" onClick={() => setShow(true)}>+ New claim</button>
      </div>
      <div className="bar">
        <input placeholder="Search patient…" value={q} onChange={e => setQ(e.target.value)} />
        <select value={ct} onChange={e => setCt(e.target.value)}>
          {TYPE_FILTERS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
        </select>
        <select value={st} onChange={e => setSt(e.target.value)}>
          <option value="">All statuses</option>
          {CLAIM_STATUSES.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
        </select>
      </div>
      {!view.length ? <div className="empty">No insurance claims yet.</div> : (
        <table className="tbl">
          <thead><tr><th>Type</th><th>Patient</th><th>Insurer</th><th>Policy #</th><th>Amount</th><th>Submitted</th><th>Resolved</th><th>Status</th><th></th></tr></thead>
          <tbody>{view.map(c => {
            const isPreAuth = (c.claim_type || 'claim') === 'pre_authorization'
            return (
              <tr key={c.id}>
                <td><span className={`badge ${isPreAuth ? 'b-partial' : 'b-in_progress'}`}>{isPreAuth ? 'pre-auth' : 'claim'}</span></td>
                <td className="link" onClick={() => nav('/patients/' + c.patients?.id)}>{c.patients?.full_name}</td>
                <td>{c.insurer_name || '—'}</td><td>{c.policy_number || '—'}</td>
                <td>{inr(c.claim_amount)}</td><td>{fmtD(c.submitted_date)}</td><td>{fmtD(c.resolved_date)}</td>
                <td><StatusSelect value={c.status} options={CLAIM_STATUSES} onChange={s => setStatus(c.id, s)} /></td>
                <td>
                  {isPreAuth && c.status === 'approved' && <button className="btn sm ghost" onClick={() => setFileFrom(c)}>File claim</button>}{' '}
                  <button className="btn sm ghost danger" onClick={() => setConfirmDel(c.id)}>Delete</button>
                </td>
              </tr>
            )
          })}</tbody>
        </table>
      )}
      {show && <ClaimForm onClose={() => setShow(false)} onDone={() => { setShow(false); load() }} />}
      {fileFrom && <ClaimForm fromPreAuth={fileFrom} onClose={() => setFileFrom(null)} onDone={() => { setFileFrom(null); load() }} />}
      {confirmDel && <ConfirmDialog title="Move this insurance claim to trash?" confirmLabel="Move to trash" onCancel={() => setConfirmDel(null)}
        onConfirm={() => { remove(confirmDel); setConfirmDel(null) }} />}
    </>
  )
}

function ClaimForm({ fromPreAuth, onClose, onDone }) {
  const [patients, setPatients] = useState([])
  const [invoices, setInvoices] = useState([])
  const [f, setF] = useState({
    patient_id: fromPreAuth?.patient_id || '', claim_type: fromPreAuth ? 'claim' : 'pre_authorization',
    invoice_id: '', insurer_name: fromPreAuth?.insurer_name || '', policy_number: fromPreAuth?.policy_number || '',
    claim_amount: fromPreAuth?.claim_amount || '', submitted_date: today(), notes: '',
  })
  const toast = useToast()
  const set = k => e => setF(x => ({ ...x, [k]: e.target.value }))

  useEffect(() => {
    if (!fromPreAuth) {
      sb.from('patients').select('id,full_name').order('full_name').then(({ data }) => {
        setPatients(data ?? [])
        if (data?.length) setF(x => ({ ...x, patient_id: data[0].id }))
      })
    }
  }, [])

  useEffect(() => {
    if (!f.patient_id) return
    sb.from('invoices').select('id, amount, invoice_date').eq('patient_id', f.patient_id).order('invoice_date', { ascending: false })
      .then(({ data }) => setInvoices(data ?? []))
  }, [f.patient_id])

  async function save() {
    if (!f.patient_id) return toast('Pick a patient.')
    const { error } = await sb.from('insurance_claims').insert({
      patient_id: f.patient_id, claim_type: f.claim_type, invoice_id: f.invoice_id || null,
      insurer_name: f.insurer_name.trim() || null, policy_number: f.policy_number.trim() || null,
      claim_amount: parseFloat(f.claim_amount) || null, submitted_date: f.submitted_date || null, notes: f.notes.trim() || null,
    })
    if (error) return toast('Error: ' + error.message)
    toast(f.claim_type === 'pre_authorization' ? 'Pre-authorization created' : 'Claim created'); onDone()
  }

  return (
    <Modal title={fromPreAuth ? 'File claim from approved pre-authorization' : 'New insurance claim'} onClose={onClose}>
      {fromPreAuth ? (
        <p style={{ fontSize: '.78rem', color: 'var(--mid)', marginBottom: '.75rem' }}>
          For {fromPreAuth.patients?.full_name} · {fromPreAuth.insurer_name || 'insurer not set'}
        </p>
      ) : (
        <>
          <label>Patient *</label>
          <select value={f.patient_id} onChange={set('patient_id')}>
            {patients.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
          </select>
          <label>Type</label>
          <select value={f.claim_type} onChange={set('claim_type')}>
            <option value="pre_authorization">Pre-Authorization (before treatment)</option>
            <option value="claim">Claim (after treatment)</option>
          </select>
        </>
      )}
      <label>Linked invoice</label>
      <select value={f.invoice_id} onChange={set('invoice_id')}>
        <option value="">—</option>
        {invoices.map(i => <option key={i.id} value={i.id}>{fmtD(i.invoice_date)} · {inr(i.amount)}</option>)}
      </select>
      <div className="mrow">
        <div><label>Insurer</label><input value={f.insurer_name} onChange={set('insurer_name')} /></div>
        <div><label>Policy number</label><input value={f.policy_number} onChange={set('policy_number')} /></div>
      </div>
      <div className="mrow">
        <div><label>{f.claim_type === 'pre_authorization' ? 'Estimated amount (INR)' : 'Claim amount (INR)'}</label>
          <input type="number" value={f.claim_amount} onChange={set('claim_amount')} /></div>
        <div><label>Submitted date</label><input type="date" value={f.submitted_date} onChange={set('submitted_date')} /></div>
      </div>
      <label>Notes</label><input value={f.notes} onChange={set('notes')} />
      <button className="btn" onClick={save}>Save {f.claim_type === 'pre_authorization' ? 'pre-authorization' : 'claim'}</button>
    </Modal>
  )
}
