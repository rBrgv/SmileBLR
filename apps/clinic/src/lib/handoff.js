export const localDate = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
export function appointmentTimes(date, time, frequency, count) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('Enter a valid date and time.')
  const base = new Date(date + 'T' + time + ':00')
  if (localDate(base) !== date || !Number.isFinite(base.getTime()) || !Number.isInteger(count) || count < 1 || count > 24) throw new Error('Enter a valid date, time and 1–24 visits.')
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(base)
    if (frequency === 'monthly') {
      d.setDate(1); d.setMonth(d.getMonth() + i)
      const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
      d.setDate(Math.min(base.getDate(), last))
    } else d.setDate(d.getDate() + i * (frequency === 'biweekly' ? 14 : 7))
    return d.toISOString()
  })
}
export const billed = v => Math.round((Number(v.amount) + Number(v.tax_amount || 0)) * 100) / 100
export const received = v => v.amount_paid == null ? (v.payment_status === 'paid' ? billed(v) : 0) : Number(v.amount_paid)
export const balance = v => v.payment_status === 'refunded' ? 0 : Math.max(0, Math.round((billed(v) - received(v)) * 100) / 100)
export async function fetchAll(makeQuery) {
  const rows = []
  for (let offset = 0; ; ) {
    const { data, error } = await makeQuery().range(offset, offset + 499)
    if (error) throw error
    if (!data?.length) return rows
    rows.push(...data); offset += data.length
  }
}
