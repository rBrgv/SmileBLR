import PaymentEditor from '../components/PaymentEditor'
import InvoiceForm from '../components/InvoiceForm'
import { received, balance, fetchAll } from '../lib/handoff'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { fmtD, inr } from '../lib/format'
import { invoiceNo, receiptNo } from '../lib/bills'
import { waLink, invoiceMessage, receiptMessage } from '../lib/share'
import { useToast } from '../components/Toast'

export default function Invoices() {
  const [rows, setRows] = useState(null)
  const [receipts, setReceipts] = useState({}) // invoice id -> latest receipt
  const [editing, setEditing] = useState(null)
  const [doctors, setDoctors] = useState([])
  const toast = useToast()
  const nav = useNavigate()

  async function load() {
    try {
      const data = await fetchAll(() => sb.from('invoices').select('*, patients(full_name,phone), staff(full_name)').order('invoice_date', { ascending: false }).order('id'))
      setRows(data)
      // One receipt per payment taken; the newest is the one reception reprints.
      const paid = await fetchAll(() => sb.from('invoice_payment_changes').select('*').order('receipt_number'))
      setReceipts(Object.fromEntries(paid.map(r => [r.invoice_id, r])))
    } catch (e) { toast('Error: ' + e.message) }
  }

  useEffect(() => { load() }, [])
  // Needed only when an invoice is opened for editing, but cheap and small.
  useEffect(() => {
    sb.from('staff').select('id, full_name').eq('role', 'doctor').eq('active', true).order('full_name')
      .then(({ data }) => setDoctors(data ?? []))
  }, [])

  if (!rows) return <div className="empty">Loading…</div>
  const pend = rows.reduce((a, r) => a + balance(r), 0)
  const paid = rows.reduce((a, r) => a + received(r), 0)

  return (
    <>
      <div className="pagehead"><h2>Invoices</h2></div>
      {rows.some(v => v.payment_status === 'partial' && v.amount_paid == null) && <p className="allergy-alert">Reconcile legacy partial payments. Outstanding includes their full amounts until corrected.</p>}
      <div className="stats">
        <div className="stat green"><b>{inr(paid)}</b><span>Collected</span></div>
        <div className="stat pink"><b>{inr(pend)}</b><span>Outstanding</span></div>
        <div className="stat"><b>{rows.length}</b><span>Invoices</span></div>
        <div />
      </div>
      {!rows.length ? <div className="empty">No invoices yet. Create one from a patient page.</div> : (
        <table className="tbl">
          <thead><tr><th>Invoice #</th><th>Date</th><th>Patient</th><th>Amount</th><th>Method</th><th>Doctor</th><th>Status</th><th>Last receipt</th><th></th></tr></thead>
          <tbody>{rows.map(v => (
            <tr key={v.id}>
              <td>{invoiceNo(v)}</td>
              <td>{fmtD(v.invoice_date)}</td>
              <td className="link" onClick={() => nav('/patients/' + v.patient_id)}>{v.patients?.full_name}</td>
              <td>{inr(v.amount)}{v.tax_amount ? <span style={{ color: 'var(--soft)' }}> +{inr(v.tax_amount)} tax</span> : ''}</td>
              <td>{v.payment_method || '—'}</td>
              <td>{v.staff?.full_name || '—'}</td>
              <td><PaymentEditor invoice={v} onDone={load} /></td>
              <td>{receipts[v.id]
                ? <><a className="btn sm ghost" target="_blank" rel="noreferrer" href={'/print/receipt/' + receipts[v.id].id}>{receiptNo(receipts[v.id])}</a>{' '}
                  {waLink(v.patients?.phone) && <a className="btn sm green" target="_blank" rel="noreferrer" href={waLink(v.patients.phone, receiptMessage(v, v.patients, receipts[v.id]))}>Share</a>}</>
                : '—'}</td>
              <td>
                <button className="btn sm ghost" onClick={() => setEditing(v)}>Edit</button>{' '}
                <a className="btn sm ghost" target="_blank" rel="noreferrer" href={'/print/invoice/' + v.id}>Print</a>{' '}
                {waLink(v.patients?.phone) && <a className="btn sm green" target="_blank" rel="noreferrer" href={waLink(v.patients.phone, invoiceMessage(v, v.patients))}>Share</a>}
              </td>
            </tr>
          ))}</tbody>
        </table>
      )}
      {editing && (
        <InvoiceForm
          patientId={editing.patient_id} invoice={editing} doctors={doctors}
          onClose={() => setEditing(null)}
          onDone={() => { setEditing(null); load() }} />
      )}
    </>
  )
}
