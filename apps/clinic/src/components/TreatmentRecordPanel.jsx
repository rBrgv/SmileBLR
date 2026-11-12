import ClinicalButton from './ClinicalButton'
import { useEffect, useState } from 'react'
import { sb } from '../lib/supabase'
import { fmtD, inr, today } from '../lib/format'
import { statusLabel } from '../lib/status'
import StatusSelect from './StatusSelect'
import { billed as billedAmount, received as receivedAmount, balance as balanceDue, credit as creditDue } from '../lib/handoff'
import { useToast } from './Toast'
import Modal from './Modal'
import VoiceNote from './VoiceNote'
import ConfirmDialog from './ConfirmDialog'
import ToothSelect from './ToothSelect'
import PatientPicker from './PatientPicker'
import ToothMultiSelect from './ToothMultiSelect'
import InvoiceForm from './InvoiceForm'
import { recordRows, billedRecords, recordTotal, recordTotals } from '../lib/records'
import { canWriteClinical } from '../lib/clinical'
import { useRole } from '../lib/RoleContext'
import { invoiceNo } from '../lib/bills'

export const RECORD_STATUSES = ['pending', 'in_progress', 'completed', 'not_treated']

export function RecordForm({ patientId, stageId, record, onClose, onDone }) {
  const editing = Boolean(record)
  const [appts, setAppts] = useState([])
  const [treatments, setTreatments] = useState([])
  const [staff, setStaff] = useState([])
  const [busy, setBusy] = useState(false)
  const [f, setF] = useState({
    patient_id: patientId || record?.patient_id || '', appointment_id: record?.appointment_id || '', treatment_id: record?.treatment_id || '',
    tooth_number: record?.tooth_number ?? '', teeth: [], performed_by: record?.performed_by || '', performed_date: record?.performed_date || today(),
    notes: record?.notes || '', follow_up_required: record?.follow_up_required || false, follow_up_date: record?.follow_up_date || '',
    amount: record?.amount ?? '', units: record?.units ?? 1, discount: record?.discount ?? 0, status: record?.status || 'completed',
  })
  const toast = useToast()
  const set = k => e => setF(x => ({ ...x, [k]: e.target.value }))
  const pid = patientId || f.patient_id

  useEffect(() => {
    sb.from('treatments').select('*').order('name').then(({ data }) => setTreatments(data ?? []))
    sb.from('staff').select('*').eq('active', true).order('full_name').then(({ data }) => setStaff(data ?? []))
  }, [])

  useEffect(() => {
    if (!pid) return setAppts([])
    sb.from('appointments').select('id, appointment_time').eq('patient_id', pid).order('appointment_time', { ascending: false })
      .then(({ data }) => setAppts(data ?? []))
  }, [pid])

  // Choosing a treatment suggests its list price when no cost has been typed.
  // It lands in the box where it can be changed, so it is never a hidden figure.
  const listPrice = treatments.find(t => t.id === f.treatment_id)?.price_min
  function pickTreatment(e) {
    const id = e.target.value
    const price = treatments.find(t => t.id === id)?.price_min
    setF(x => ({ ...x, treatment_id: id, amount: x.amount === '' && price > 0 ? String(price) : x.amount }))
  }

  async function save() {
    if (!pid) return toast('Pick a patient.')
    const amount = f.amount === '' ? null : Number(f.amount)
    const units = Number(f.units), discount = Number(f.discount || 0)
    if (amount != null && (!Number.isFinite(amount) || amount < 0)) return toast('Enter the cost as a number, or leave it empty.')
    if (!Number.isInteger(units) || units < 1) return toast('Units must be a whole number, 1 or more.')
    if (!Number.isFinite(discount) || discount < 0) return toast('Enter the discount as a number, or leave it at 0.')
    if (discount > 0 && amount == null) return toast('Enter the cost before giving a discount.')
    if (amount != null && discount > units * amount) return toast('The discount cannot be more than the cost.')
    setBusy(true)
    const row = {
      appointment_id: f.appointment_id || null, treatment_id: f.treatment_id || null,
      performed_by: f.performed_by || null,
      performed_date: f.performed_date || null, notes: f.notes.trim() || null, amount, units, discount, status: f.status,
      follow_up_required: f.follow_up_required, follow_up_date: f.follow_up_required ? (f.follow_up_date || null) : null,
    }
    // An edit changes one record. A new entry makes one record per tooth chosen,
    // saved together, so two teeth for the same procedure are entered once.
    const rows = editing ? null : recordRows({ ...row, patient_id: pid, stage_id: stageId || null }, f.teeth)
    const { error } = editing
      ? await sb.from('treatment_records').update({ ...row, tooth_number: parseInt(f.tooth_number) || null }).eq('id', record.id)
      : await sb.from('treatment_records').insert(rows)
    setBusy(false)
    if (error) return toast('Error: ' + error.message)
    toast(editing ? 'Treatment record updated' : rows.length > 1 ? `${rows.length} treatment records saved` : 'Treatment record saved'); onDone()
  }

  return (
    <Modal title={editing ? 'Edit treatment record' : 'New treatment record'} onClose={() => !busy && onClose()}>
      {!patientId && !editing && (
        <>
          <label>Patient *</label>
          <PatientPicker value={f.patient_id} onChange={id => setF(x => ({ ...x, patient_id: id }))} />
        </>
      )}
      <div className="mrow">
        <div><label>Treatment</label><select value={f.treatment_id} onChange={pickTreatment}>
          <option value="">—</option>{treatments.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></div>
        <div><label>{editing ? 'Tooth number' : 'Tooth number(s)'}</label>
          {editing
            ? <ToothSelect value={f.tooth_number} onChange={set('tooth_number')} />
            : <ToothMultiSelect value={f.teeth} onChange={teeth => setF(x => ({ ...x, teeth }))} />}</div>
      </div>
      <div className="mrow">
        <div><label>Units</label><input type="number" min="1" step="1" value={f.units} onChange={set('units')} /></div>
        <div><label>Cost each (₹){listPrice > 0 ? ` — list ₹${Number(listPrice).toLocaleString('en-IN')}` : ''}</label>
          <input type="number" min="0" step="0.01" placeholder="Leave empty if unknown" value={f.amount} onChange={set('amount')} /></div>
        <div><label>Discount (₹)</label><input type="number" min="0" step="0.01" value={f.discount} onChange={set('discount')} /></div>
      </div>
      {f.amount !== '' && (
        <p className="sub" style={{ margin: '.25rem 0 .5rem' }}>
          Total{f.teeth.length > 1 ? ` per tooth` : ''}: <b>{inr(recordTotal({ amount: f.amount, units: f.units, discount: f.discount }))}</b>
          {f.teeth.length > 1 && <> · {f.teeth.length} teeth = <b>{inr(f.teeth.length * recordTotal({ amount: f.amount, units: f.units, discount: f.discount }))}</b></>}
        </p>
      )}
      <div className="mrow">
        <div><label>Status</label><StatusSelect value={f.status} options={RECORD_STATUSES} onChange={status => setF(x => ({ ...x, status }))} /></div>
        <div><label>Date</label><input type="date" value={f.performed_date} onChange={set('performed_date')} /></div>
      </div>
      <div className="mrow">
        <div><label>Appointment</label><select value={f.appointment_id} onChange={set('appointment_id')}>
          <option value="">—</option>{appts.map(a => <option key={a.id} value={a.id}>{fmtD(a.appointment_time)}</option>)}</select></div>
        <div><label>Performed by</label><select value={f.performed_by} onChange={set('performed_by')}>
          <option value="">—</option>{staff.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}</select></div>
      </div>
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
      <ClinicalButton className="btn" disabled={busy} onClick={save}>{busy ? 'Saving…' : editing ? 'Save changes' : 'Save record'}</ClinicalButton>
    </Modal>
  )
}

export default function TreatmentRecordPanel({ patientId }) {
  const [rows, setRows] = useState(null)
  const [form, setForm] = useState(null) // {} for new, the row for an edit
  const [confirmDel, setConfirmDel] = useState(null)
  const [picked, setPicked] = useState([]) // record ids ticked for an invoice
  const [billing, setBilling] = useState(null) // records being invoiced
  const [invoices, setInvoices] = useState([])
  const [billingConfirmed, setBillingConfirmed] = useState(false) // the user accepted billing something twice
  const [doctors, setDoctors] = useState([])
  const toast = useToast()
  const canEdit = canWriteClinical(useRole())
  const billed = billedRecords(invoices) // record id -> the invoice that carries it
  const alreadyBilled = Boolean(billing?.some(r => billed[r.id]))
  const closeBilling = () => { setBilling(null); setBillingConfirmed(false) }

  async function load() {
    sb.from('invoices').select('id, invoice_number, items, amount, tax_amount, amount_paid, payment_status').eq('patient_id', patientId).then(({ data }) => setInvoices(data ?? []))
    sb.from('staff').select('id, full_name').eq('role', 'doctor').eq('active', true).order('full_name').then(({ data }) => setDoctors(data ?? []))
    const { data, error } = await sb.from('treatment_records').select('*, treatments(name, price_min), staff(full_name)')
      .eq('patient_id', patientId).is('deleted_at', null).order('performed_date', { ascending: false })
    if (error) { toast('Error: ' + error.message); return setRows([]) }
    setRows(data)
  }
  useEffect(() => { load() }, [patientId])

  async function setStatus(r, status) {
    const { error } = await sb.from('treatment_records').update({ status }).eq('id', r.id)
    if (error) return toast('Error: ' + error.message)
    toast(statusLabel(status)); load()
  }

  async function remove(id) {
    const { error } = await sb.from('treatment_records').update({ deleted_at: new Date().toISOString() }).eq('id', id)
    if (error) return toast('Error: ' + error.message)
    toast('Moved to trash', { actionLabel: 'Undo', onAction: async () => { await sb.from('treatment_records').update({ deleted_at: null }).eq('id', id); load() } })
    load()
  }

  async function markCalled(id) {
    const { error } = await sb.rpc('mark_followup_called', { p_id: id })
    if (error) return toast('Error: ' + error.message)
    toast('Marked as called'); load()
  }

  if (!rows) return <div className="empty">Loading…</div>

  // Procedures, then what has been billed for them and what has come in. Paid
  // and balance come from the payments recorded on the bills, not typed per
  // line, so they cannot drift away from the receipts.
  const t = recordTotals(rows)
  const money = invoices.reduce((a, v) => ({
    billed: a.billed + billedAmount(v), received: a.received + receivedAmount(v), due: a.due + balanceDue(v), credit: a.credit + creditDue(v),
  }), { billed: 0, received: 0, due: 0, credit: 0 })
  const unbilled = recordTotals(rows.filter(r => !billed[r.id])).grand
  const round = n => Math.round(n * 100) / 100

  return (
    <>
      <ClinicalButton className="btn" style={{ marginBottom: '.75rem' }} onClick={() => setForm({})}>+ New record</ClinicalButton>
      {rows.length > 0 && (
        <p style={{ marginBottom: '.5rem' }}>
          <button className="btn sm green" disabled={!picked.length}
            onClick={() => setBilling(rows.filter(r => picked.includes(r.id)))}>Create invoice{picked.length ? ` (${picked.length})` : ''}</button>{' '}
          <button className="btn sm ghost" onClick={() => setPicked(rows.filter(r => !billed[r.id] && r.status !== 'not_treated').map(r => r.id))}>Tick all not yet billed</button>
          {picked.length > 0 && <>{' '}<button className="btn sm ghost" onClick={() => setPicked([])}>Clear</button></>}
        </p>
      )}
      {!rows.length ? <div className="empty">No treatment records yet.</div> : (
        <>
          <table className="tbl">
            <thead><tr><th></th><th>Date</th><th>Treatment</th><th>Tooth</th><th>By</th><th>Units</th><th>Cost</th><th>Discount</th><th>Total</th><th>Status</th><th>Billed</th><th></th></tr></thead>
            <tbody>{rows.map(r => (
              <tr key={r.id} style={r.status === 'not_treated' ? { opacity: .6 } : undefined}>
                <td><input type="checkbox" style={{ width: 'auto' }} aria-label="Tick to invoice" checked={picked.includes(r.id)}
                  onChange={e => setPicked(p => e.target.checked ? [...p, r.id] : p.filter(x => x !== r.id))} /></td>
                <td>{fmtD(r.performed_date)}</td>
                <td>
                  {r.treatments?.name || '—'}
                  {r.notes && <><br /><span style={{ color: 'var(--soft)' }}>{r.notes}</span></>}
                  {r.follow_up_required && <><br /><span style={{ color: 'var(--soft)' }}>Follow-up {fmtD(r.follow_up_date)}</span>{' '}<button className="btn sm ghost" onClick={() => markCalled(r.id)}>Mark called</button></>}
                </td>
                <td>{r.tooth_number || '—'}</td><td>{r.staff?.full_name || '—'}</td>
                <td>{r.units ?? 1}</td>
                <td>{r.amount == null ? '—' : inr(r.amount)}</td>
                <td>{Number(r.discount) > 0 ? inr(r.discount) : '—'}</td>
                <td><b>{r.amount == null ? '—' : inr(recordTotal(r))}</b></td>
                <td><StatusSelect disabled={!canEdit} value={r.status ?? 'completed'} options={RECORD_STATUSES} onChange={st => setStatus(r, st)} /></td>
                <td>{billed[r.id] ? <span className="badge b-completed">{invoiceNo(billed[r.id])}</span> : '—'}</td>
                <td>
                  <ClinicalButton className="btn sm ghost" onClick={() => setForm(r)}>Edit</ClinicalButton>{' '}
                  <a className="btn sm ghost" target="_blank" rel="noreferrer" href={'/print/post-op/' + r.id}>Post-op</a>{' '}
                  <ClinicalButton className="btn sm ghost danger" onClick={() => setConfirmDel(r.id)}>Delete</ClinicalButton>
                </td>
              </tr>
            ))}</tbody>
          </table>
          <div className="stats" style={{ marginTop: '.75rem' }}>
            <div className="stat"><b>{inr(t.cost)}</b><span>Total cost</span></div>
            <div className="stat"><b>{inr(t.discount)}</b><span>Total discount</span></div>
            <div className="stat gold"><b>{inr(t.grand)}</b><span>Grand total{t.missing ? ` · ${t.missing} without a cost` : ''}</span></div>
            <div />
          </div>
          <div className="stats" style={{ marginTop: '.5rem' }}>
            <div className="stat"><b>{inr(round(money.billed))}</b><span>Billed on invoices</span></div>
            <div className="stat green"><b>{inr(round(money.received))}</b><span>Received</span></div>
            <div className="stat pink"><b>{inr(round(money.due))}</b><span>Balance due on bills{money.credit > 0 ? ` · credit ${inr(round(money.credit))}` : ''}</span></div>
            <div className="stat"><b>{inr(round(unbilled))}</b><span>Not yet billed</span></div>
          </div>
          <p className="sub" style={{ marginTop: '.4rem' }}>Work marked Not Treated is left out of the totals. Payments are recorded on the bill, under Bills.</p>
        </>
      )}
      {billing && alreadyBilled && !billingConfirmed && (
        <ConfirmDialog title="Some of these are already billed"
          body={'Already on an invoice: ' + billing.filter(r => billed[r.id]).map(r => (r.treatments?.name || 'Treatment') + ' (' + invoiceNo(billed[r.id]) + ')').join(', ') + '. Billing them again would charge the patient twice. Continue only if that is intended.'}
          confirmLabel="Continue" onCancel={closeBilling} onConfirm={() => setBillingConfirmed(true)} />
      )}
      {billing && (!alreadyBilled || billingConfirmed) && (
        <InvoiceForm patientId={patientId} doctors={doctors} fromRecords={billing} onClose={closeBilling}
          onDone={() => { closeBilling(); setPicked([]); load(); toast('Invoice created · see the Bills tab') }} />
      )}
      {form && <RecordForm patientId={patientId} record={form.id ? form : null} onClose={() => setForm(null)} onDone={() => { setForm(null); load() }} />}
      {confirmDel && <ConfirmDialog title="Move this record to trash?" confirmLabel="Move to trash" onCancel={() => setConfirmDel(null)}
        onConfirm={() => { remove(confirmDel); setConfirmDel(null) }} />}
    </>
  )
}
