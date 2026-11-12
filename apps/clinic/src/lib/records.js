import { inr } from './format.js'

const round = n => Math.round(n * 100) / 100

// What one line comes to: units at the cost each, less its discount. A line
// with no cost is unknown, not zero, and has no total.
export function recordTotal(r) {
  if (r.amount == null) return null
  return round(Number(r.units ?? 1) * Number(r.amount) - Number(r.discount ?? 0))
}

// Totals over a list of lines. Work marked Not Treated was never done or
// charged, so it is left out; everything else counts, planned lines included,
// as on the clinic's old treatment screen. A line with no cost is counted in
// `missing` rather than quietly as zero, so a total says what it could not add.
export function recordTotals(rows) {
  let cost = 0, discount = 0, missing = 0
  for (const r of rows) {
    if (r.status === 'not_treated') continue
    if (r.amount == null) { missing++; continue }
    cost += Number(r.units ?? 1) * Number(r.amount)
    discount += Number(r.discount ?? 0)
  }
  return { cost: round(cost), discount: round(discount), grand: round(cost - discount), missing }
}

export const costTotal = rows => { const t = recordTotals(rows); return { total: t.grand, missing: t.missing } }

export const costSummary = rows => {
  const { total, missing } = costTotal(rows)
  return inr(total) + (missing ? ` · ${missing} without a cost` : '')
}

// One record per tooth, matching how the imported history is shaped. A cost is
// per tooth, so two crowns at 5,000 are two records of 5,000. The follow-up
// call goes on the first record only, so one procedure is one phone call.
export function recordRows(base, teeth) {
  const list = teeth.length ? teeth : [null]
  return list.map((tooth, i) => ({
    ...base, tooth_number: tooth,
    ...(i === 0 ? {} : { follow_up_required: false, follow_up_date: null }),
  }))
}

// Invoice lines for treatment records, priced from the cost recorded on the
// procedure and only then from the price list, so a bill matches what the
// treatment list shows.
export const invoiceLinesFrom = records => records.map(r => ({
  description: r.treatments?.name || r.notes || 'Treatment',
  tooth_number: r.tooth_number ?? '', quantity: Number(r.units ?? 1), discount: Number(r.discount ?? 0), tax_rate: 0,
  unit_price: Number(r.amount ?? r.treatments?.price_min ?? 0),
  treatment_record_id: r.id,
}))

// Which records an invoice already covers, so a procedure is not billed twice.
// Maps record id -> the invoice that carries it.
export function billedRecords(invoices) {
  const map = {}
  for (const inv of invoices) for (const line of inv.items ?? []) {
    if (line.treatment_record_id) map[line.treatment_record_id] = inv
  }
  return map
}
