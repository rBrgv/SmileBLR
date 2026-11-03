import { CLINIC } from './clinicInfo.js'
import { digits, fmtD, inr } from './format.js'
import { billed, received, balance, credit } from './handoff.js'
import { invoiceNo, receiptNo, receiptAmounts } from './bills.js'

// wa.me rejects a number without a country code, and the clinic's numbers are
// stored as they were typed — usually ten digits, sometimes with 91 or a
// leading 0. Same rule the WhatsApp sender uses server-side (api/_lib/wa.js):
// the last ten digits are the number, +91 is the country. A longer number that
// does not start with 91 is left alone — it already carries its own code.
export function waNumber(phone) {
  const d = digits(phone)
  if (d.length === 10) return '91' + d
  if (d.length === 11 && d.startsWith('0')) return '91' + d.slice(1)
  if (d.length === 12 && d.startsWith('91')) return d
  return d.length > 10 ? d : null
}

export function waLink(phone, text) {
  const n = waNumber(phone)
  return n ? 'https://wa.me/' + n + (text ? '?text=' + encodeURIComponent(text) : '') : null
}

const sign = lines => lines.filter(Boolean).concat('', CLINIC.name + ' · ' + CLINIC.phoneMobile).join('\n')

export function invoiceMessage(invoice, patient) {
  const due = balance(invoice), over = credit(invoice)
  return sign([
    `${patient?.full_name || 'Patient'}, here is your bill from ${CLINIC.name}.`,
    '',
    `Invoice ${invoiceNo(invoice)} · ${fmtD(invoice.invoice_date)}`,
    `Total: ${inr(billed(invoice))}`,
    `Received: ${inr(received(invoice))}`,
    over > 0 ? `Refund due to you: ${inr(over)}`
      : due > 0 ? `Balance due: ${inr(due)}` : 'Paid in full. Thank you.',
  ])
}

export function receiptMessage(invoice, patient, row) {
  const a = receiptAmounts(invoice, row)
  return sign([
    `${patient?.full_name || 'Patient'}, thank you. Your payment is received at ${CLINIC.name}.`,
    '',
    `Receipt ${receiptNo(row)} · ${fmtD(row.created_at)}`,
    `Against invoice ${invoiceNo(invoice)} · ${fmtD(invoice.invoice_date)}`,
    a.refunded ? `Refunded in full: ${inr(a.prior ?? a.total)}`
      : a.collected == null ? `Total received to date: ${inr(a.toDate)}`
      : a.collected < 0 ? `Correction: ${inr(-a.collected)} returned · total received ${inr(a.toDate)}`
      : `Received now: ${inr(a.collected)}${a.prior ? ` · total received ${inr(a.toDate)}` : ''}`,
    row.payment_method ? `Mode: ${row.payment_method}` : null,
    a.credit > 0 ? `Refund due to you: ${inr(a.credit)}`
      : a.balance > 0 ? `Balance due: ${inr(a.balance)}` : 'Nothing further due.',
  ])
}

export function planMessage(plan, stages, patient) {
  const lines = [...(stages || [])].sort((a, b) => a.stage_number - b.stage_number)
  return sign([
    `${patient?.full_name || 'Patient'}, here is the treatment estimate from ${CLINIC.name}.`,
    plan.plan_description ? '' : null,
    plan.plan_description || null,
    '',
    ...lines.map(s => `${s.stage_number}. ${s.description || 'Stage ' + s.stage_number}${s.estimated_cost ? ' — ' + inr(s.estimated_cost) : ''}`),
    lines.length ? '' : null,
    `Estimated total: ${inr(plan.total_estimated_cost)}`,
    'This is an estimate and may change once treatment begins. Reply here with any questions.',
  ])
}
