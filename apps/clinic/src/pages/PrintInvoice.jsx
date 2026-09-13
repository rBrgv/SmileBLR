import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { fmtD, inr } from '../lib/format'
import PrintDoc from '../components/PrintDoc'

export default function PrintInvoice() {
  const { id } = useParams()
  const [inv, setInv] = useState(null)

  useEffect(() => {
    sb.from('invoices').select('*, patients(full_name,phone,address), staff(full_name)').eq('id', id).single()
      .then(({ data }) => setInv(data))
  }, [id])

  if (!inv) return <div className="empty">Loading…</div>
  const total = Number(inv.amount) + Number(inv.tax_amount || 0)
  return (
    <PrintDoc title="Invoice">
      {inv.invoice_number && <div className="print-row"><b>Invoice #</b><span>{String(inv.invoice_number).padStart(6, '0')}</span></div>}
      <div className="print-row"><b>Invoice date</b><span>{fmtD(inv.invoice_date)}</span></div>
      <div className="print-row"><b>Patient</b><span>{inv.patients?.full_name}</span></div>
      <div className="print-row"><b>Phone</b><span>{inv.patients?.phone || '—'}</span></div>
      {inv.patients?.address && <div className="print-row"><b>Address</b><span>{inv.patients.address}</span></div>}
      {inv.staff?.full_name && <div className="print-row"><b>Treating doctor</b><span>{inv.staff.full_name}</span></div>}
      <div className="print-row"><b>Payment method</b><span>{inv.payment_method || '—'}</span></div>
      <div className="print-row"><b>Status</b><span>{inv.payment_status}</span></div>
      {inv.notes && <div className="print-block"><h4>Notes</h4><p>{inv.notes}</p></div>}
      <div className="print-row"><b>Subtotal</b><span>{inr(inv.amount)}</span></div>
      {inv.tax_amount ? <div className="print-row"><b>Tax</b><span>{inr(inv.tax_amount)}</span></div> : null}
      <div className="print-amount">{inr(total)}</div>
      <div className="print-signature">
        <div>Authorized signature</div>
        <div>Patient signature</div>
      </div>
    </PrintDoc>
  )
}
