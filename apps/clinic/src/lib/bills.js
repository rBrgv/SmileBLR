import { billed } from './handoff.js'

const round = n => Math.round(n * 100) / 100

// Printed identities. The invoice number is the SERIAL the row was born with
// and never changes, even when the invoice is edited; the receipt number comes
// from the payment event, so a correction is a new receipt rather than a
// quiet reprint of the old one.
export const invoiceNo = v => v?.invoice_number ? 'INV' + String(v.invoice_number).padStart(6, '0') : '—'
export const receiptNo = r => r?.receipt_number ? 'RCPT' + String(r.receipt_number).padStart(6, '0') : '—'

// What one payment event actually collected. invoice_payment_changes records
// the running total received, so the money that changed hands that day is the
// difference between the two. A legacy partial has no known previous amount,
// and then only the running total can be printed.
export function receiptAmounts(invoice, row) {
  const total = billed(invoice)
  const toDate = Number(row.new_amount)
  const prior = row.old_amount == null ? null : Number(row.old_amount)
  const refunded = row.new_status === 'refunded'
  return {
    total,
    toDate,
    prior,
    collected: prior == null ? null : round(toDate - prior),
    balance: refunded ? 0 : Math.max(0, round(total - toDate)),
    credit: refunded ? 0 : Math.max(0, round(toDate - total)),
    refunded,
  }
}
