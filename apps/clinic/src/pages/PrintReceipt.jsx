import { lineTotals } from '../lib/clinical'
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { fmtD, fmtDT, inr } from '../lib/format'
import { ageLabel } from '../lib/age'
import { invoiceNo, receiptNo, receiptAmounts } from '../lib/bills'
import { rupeesInWords } from '../lib/words'
import PrintDoc from '../components/PrintDoc'

// The receipt for one payment, identified by the payment event rather than by
// the invoice: the clinic hands over a numbered receipt each time money is
// taken, and an invoice can be paid in several goes.
export default function PrintReceipt() {
  const { id } = useParams()
  const [row, setRow] = useState(null)
  const [later, setLater] = useState(null) // a correction issued after this one

  useEffect(() => {
    sb.from('invoice_payment_changes')
      .select('*, invoices(*, patients(*), staff(full_name))').eq('id', id).single()
      .then(({ data }) => {
        setRow(data)
        if (!data) return
        sb.from('invoice_payment_changes').select('receipt_number, seq, created_at')
          .eq('invoice_id', data.invoice_id).gt('receipt_number', data.receipt_number)
          .order('receipt_number', { ascending: false }).limit(1)
          .then(({ data: next }) => setLater(next?.[0] || null))
      })
  }, [id])

  if (!row) return <div className="empty">Loading…</div>
  const inv = row.invoices
  const p = inv?.patients
  const a = receiptAmounts(inv, row)
  const age = ageLabel(p)
  // What this receipt acknowledges: the money taken on the day, or — for a
  // legacy payment with no recorded previous total — the running total.
  const acknowledged = a.refunded ? (a.prior ?? a.total)
    : a.collected == null ? a.toDate : Math.abs(a.collected)

  return (
    <PrintDoc title={a.refunded || (a.collected != null && a.collected < 0) ? 'Refund receipt' : 'Receipt'}>
      {later && <p className="allergy-alert">Superseded by receipt {receiptNo(later, inv)} of {fmtD(later.created_at)}. This copy is kept as it was given.</p>}
      <div className="print-row"><b>Receipt #</b><span>{receiptNo(row, inv)}</span></div>
      <div className="print-row"><b>Receipt date</b><span>{fmtDT(row.created_at)}</span></div>
      <div className="print-row"><b>Against invoice</b><span>{invoiceNo(inv)} dated {fmtD(inv.invoice_date)}</span></div>
      <div className="print-row"><b>Patient</b><span>{p?.full_name}{p?.patient_code ? ' · ' + p.patient_code : ''}{p?.manual_id ? ' · file ' + p.manual_id : ''}</span></div>
      <div className="print-row"><b>Age / gender</b><span>{[age ? age + ' yrs' : null, p?.gender].filter(Boolean).join(' · ') || '—'}</span></div>
      <div className="print-row"><b>Phone</b><span>{p?.phone || '—'}</span></div>
      {inv.staff?.full_name && <div className="print-row"><b>Treating doctor</b><span>{inv.staff.full_name}</span></div>}

      {inv.items?.length ? (
        <table className="tbl">
          <thead><tr><th>Particulars</th><th>Qty</th><th>Rate</th><th>Discount</th><th>Tax</th><th>Amount</th></tr></thead>
          <tbody>{inv.items.map((r, i) => (
            <tr key={i}>
              <td>{r.description}{r.tooth_number ? ` · Tooth ${r.tooth_number}` : ''}</td>
              <td>{r.quantity}</td><td>{inr(r.unit_price)}</td><td>{inr(r.discount)}</td>
              <td>{r.tax_rate}%</td><td>{inr(lineTotals(r).total)}</td>
            </tr>
          ))}</tbody>
        </table>
      ) : <div className="print-block"><h4>Particulars</h4><p>{inv.notes || 'Dental treatment'}</p></div>}

      <div className="print-row"><b>Grand total</b><span>{inr(a.total)}</span></div>
      {a.prior ? <div className="print-row"><b>Received earlier</b><span>{inr(a.prior)}</span></div> : null}
      <div className="print-row">
        <b>{a.refunded ? 'Refunded' : a.collected != null && a.collected < 0 ? 'Returned on this correction' : 'Received now'}</b>
        <span>{inr(acknowledged)}</span>
      </div>
      {a.collected != null && a.prior ? <div className="print-row"><b>Total received to date</b><span>{inr(a.toDate)}</span></div> : null}
      <div className="print-amount">{inr(acknowledged)}</div>
      <div className="print-block"><h4>Amount in words</h4><p>{rupeesInWords(acknowledged)}</p></div>
      <div className="print-row"><b>Payment mode</b><span>{row.payment_method || '—'}</span></div>
      {row.note && <div className="print-row"><b>Reference</b><span>{row.note}</span></div>}
      <div className="print-row">
        <b>{a.credit > 0 ? 'Refund due to patient' : 'Balance due'}</b>
        <span>{inr(a.credit > 0 ? a.credit : a.balance)}</span>
      </div>
      <div className="print-signature">
        <div>Received by</div>
        <div>Patient signature</div>
      </div>
    </PrintDoc>
  )
}
