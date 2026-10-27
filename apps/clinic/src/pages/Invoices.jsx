import PaymentEditor from '../components/PaymentEditor'
import { received, balance, fetchAll } from '../lib/handoff'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { fmtD, inr } from '../lib/format'
import { useToast } from '../components/Toast'

export default function Invoices() {
  const [rows, setRows] = useState(null)
  const toast = useToast()
  const nav = useNavigate()

  async function load() {
    try {
      const data = await fetchAll(() => sb.from('invoices').select('*, patients(full_name), staff(full_name)').order('invoice_date', { ascending: false }).order('id'))
      setRows(data)
    } catch (e) { toast('Error: ' + e.message) }
  }

  useEffect(() => { load() }, [])

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
          <thead><tr><th>#</th><th>Date</th><th>Patient</th><th>Amount</th><th>Method</th><th>Doctor</th><th>Status</th><th></th></tr></thead>
          <tbody>{rows.map(v => (
            <tr key={v.id}>
              <td>{v.invoice_number ? String(v.invoice_number).padStart(6, '0') : '—'}</td>
              <td>{fmtD(v.invoice_date)}</td>
              <td className="link" onClick={() => nav('/patients/' + v.patient_id)}>{v.patients?.full_name}</td>
              <td>{inr(v.amount)}{v.tax_amount ? <span style={{ color: 'var(--soft)' }}> +{inr(v.tax_amount)} tax</span> : ''}</td>
              <td>{v.payment_method || '—'}</td>
              <td>{v.staff?.full_name || '—'}</td>
              <td><PaymentEditor invoice={v} onDone={load} /></td>
              <td><a className="btn sm ghost" target="_blank" rel="noreferrer" href={'/print/invoice/' + v.id}>Print</a></td>
            </tr>
          ))}</tbody>
        </table>
      )}
    </>
  )
}
