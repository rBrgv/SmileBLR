import { lineTotals } from '../lib/clinical'
import { received, balance, credit } from '../lib/handoff'
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { fmtD } from '../lib/format'
import { ageLabel } from '../lib/age'
import { invoiceNo, receiptNo, receiptAmounts } from '../lib/bills'
import { rupeesInWords } from '../lib/words'
import PrintDoc from '../components/PrintDoc'

const money = n => Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const cell = { padding: '.4rem .5rem', borderBottom: '1px solid var(--rule)', fontSize: '.8rem', verticalAlign: 'top' }
const right = { ...cell, textAlign: 'right', whiteSpace: 'nowrap' }
const head = { ...cell, background: 'var(--purple)', color: '#fff', fontSize: '.68rem', letterSpacing: '.06em', textTransform: 'uppercase', fontWeight: 500 }
const label = { color: 'var(--mid)', fontWeight: 500 }

// The invoice a patient takes to their insurer, in the layout the clinic used
// before: who it is for, what was done and what each part cost, every payment
// received against it with its receipt number, and the amount in words. It is
// a computer-generated document and says so, so there is no signature block.
export default function PrintInvoice() {
  const { id } = useParams()
  const [inv, setInv] = useState(null)
  const [payments, setPayments] = useState([])

  useEffect(() => {
    sb.from('invoices').select('*, patients(*), staff(full_name)').eq('id', id).single().then(({ data }) => setInv(data))
    sb.from('invoice_payment_changes').select('*').eq('invoice_id', id).order('created_at').order('receipt_number')
      .then(({ data }) => setPayments(data ?? []))
  }, [id])

  if (!inv) return <div className="empty">Loading…</div>
  const p = inv.patients
  const lines = inv.items?.length ? inv.items : [{ description: inv.notes || 'Dental treatment', quantity: 1, unit_price: inv.amount, discount: 0, tax_rate: 0 }]
  const hasDiscount = lines.some(l => Number(l.discount) > 0)
  const hasTax = lines.some(l => Number(l.tax_rate) > 0)
  const grand = Number(inv.amount) + Number(inv.tax_amount || 0)
  const paid = received(inv)
  const owed = balance(inv), over = credit(inv)
  const age = ageLabel(p)
  const unreconciled = inv.amount_paid == null && inv.payment_status === 'partial'
  const rows = payments.map(r => ({ r, a: receiptAmounts(inv, r) }))

  return (
    <PrintDoc title="Invoice">
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '1rem' }}>
        <tbody>
          <tr>
            <td style={{ width: '60%', fontSize: '.82rem', lineHeight: 1.7, verticalAlign: 'top' }}>
              <div><span style={label}>Patient Id : </span>{p?.manual_id || p?.patient_code}</div>
              <div><span style={label}>Patient Name : </span><b>{p?.full_name}</b></div>
              <div><span style={label}>Patient Contact : </span>{p?.phone || '—'}</div>
              <div><span style={label}>Age/Gender : </span>{[age ? age + ' Years' : null, p?.gender].filter(Boolean).join(' / ') || '—'}</div>
            </td>
            <td style={{ fontSize: '.82rem', lineHeight: 1.7, textAlign: 'right', verticalAlign: 'top' }}>
              <div><b>Invoice Id : {invoiceNo(inv)}</b></div>
              <div><b>Date : {fmtD(inv.invoice_date)}</b></div>
              {inv.staff?.full_name && <div>Doctor : {inv.staff.full_name}</div>}
            </td>
          </tr>
        </tbody>
      </table>

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={{ ...head, textAlign: 'left', width: '2rem' }}>#</th>
            <th style={{ ...head, textAlign: 'left' }}>Particulars</th>
            <th style={{ ...head, textAlign: 'right' }}>Unit Cost</th>
            <th style={{ ...head, textAlign: 'right' }}>Qty</th>
            {hasDiscount && <th style={{ ...head, textAlign: 'right' }}>Discount</th>}
            {hasTax && <th style={{ ...head, textAlign: 'right' }}>Tax</th>}
            <th style={{ ...head, textAlign: 'right' }}>Total Cost</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i}>
              <td style={cell}>{i + 1}</td>
              <td style={cell}>{l.description}{l.tooth_number ? ` · Tooth ${l.tooth_number}` : ''}</td>
              <td style={right}>{money(l.unit_price)}</td>
              <td style={right}>{l.quantity}</td>
              {hasDiscount && <td style={right}>{money(l.discount || 0)}</td>}
              {hasTax && <td style={right}>{Number(l.tax_rate || 0)}%</td>}
              <td style={right}>₹ {money(inv.items?.length ? lineTotals(l).total : inv.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ textAlign: 'right', fontSize: '.82rem', lineHeight: 1.8, margin: '.75rem 0 1.25rem' }}>
        {(hasTax || hasDiscount) && <div>Total Cost: {money(inv.amount)}</div>}
        {hasTax && <div>Tax: {money(inv.tax_amount || 0)}</div>}
        <div><b>Grand Total: {money(grand)}</b></div>
        <div><b>Amount Received: {unreconciled ? 'Needs reconciliation' : money(paid)}</b></div>
        {!unreconciled && over > 0 && <div>Credit due to patient: {money(over)}</div>}
        {!unreconciled && over === 0 && owed > 0 && <div>Balance Due: {money(owed)}</div>}
      </div>

      {rows.length > 0 && (
        <table style={{ width: '60%', borderCollapse: 'collapse', marginBottom: '1rem' }}>
          <thead>
            <tr>
              <th style={{ ...head, textAlign: 'left', width: '2rem' }}>#</th>
              <th style={{ ...head, textAlign: 'left' }}>Rcpt #</th>
              <th style={{ ...head, textAlign: 'left' }}>Date</th>
              <th style={{ ...head, textAlign: 'left' }}>Mode</th>
              <th style={{ ...head, textAlign: 'right' }}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ r, a }, i) => {
              const shown = a.refunded ? -(a.prior ?? 0) : a.collected ?? a.toDate
              return (
                <tr key={r.id}>
                  <td style={cell}>{i + 1}</td>
                  <td style={cell}>{receiptNo(r, inv)}</td>
                  <td style={cell}>{fmtD(r.created_at)}</td>
                  <td style={cell}>{(r.payment_method || '—').toUpperCase()}{a.refunded ? ' (refund)' : shown < 0 ? ' (returned)' : ''}</td>
                  <td style={right}>{shown < 0 ? '−' + money(-shown) : money(shown)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      {paid > 0 && !unreconciled && (
        <p style={{ fontSize: '.8rem', margin: '1rem 0 .25rem' }}>Amount received in words : {rupeesInWords(paid)}</p>
      )}
      <p style={{ fontSize: '.8rem', margin: '.25rem 0' }}>Smile Bengaluru</p>
      <p style={{ fontSize: '.72rem', color: 'var(--mid)', margin: '.25rem 0' }}>*This is a computer generated invoice and does not require signature.</p>
    </PrintDoc>
  )
}
