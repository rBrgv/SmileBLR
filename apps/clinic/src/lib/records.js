import { inr } from './format.js'

// A cost the clinic never wrote down is blank, not zero, so a total over a list
// says how many rows it could not count rather than quietly undercounting.
export function costTotal(rows) {
  let total = 0, missing = 0
  for (const r of rows) {
    if (r.amount == null) missing++
    else total += Number(r.amount)
  }
  return { total: Math.round(total * 100) / 100, missing }
}

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
  tooth_number: r.tooth_number ?? '', quantity: 1, discount: 0, tax_rate: 0,
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
