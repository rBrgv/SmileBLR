export const canWriteClinical = role => role === 'admin' || role === 'doctor'
export const emptyMedicine = () => ({ name: '', strength: '', dose: '', frequency: '', duration: '', instructions: '' })
export const medicinesFor = r => r.medicines || [{ name: r.medicine_name, strength: '', dose: r.dosage || '', frequency: '', duration: r.duration || '', instructions: '' }]
export const emptyInvoiceLine = () => ({ description: '', tooth_number: '', quantity: 1, unit_price: '', discount: 0, tax_rate: 0 })
export function lineTotals(line) {
  const cents = n => Math.round(Number(n) * 100)
  const gross = Math.round(Number(line.quantity) * cents(line.unit_price))
  const net = gross - cents(line.discount)
  const tax = Math.round(net * Number(line.tax_rate) / 100)
  return { net: net / 100, tax: tax / 100, total: (net + tax) / 100 }
}
export function invoiceTotals(lines) {
  return lines.reduce((total, line) => { const v = lineTotals(line); return { net: Math.round((total.net + v.net) * 100) / 100, tax: Math.round((total.tax + v.tax) * 100) / 100, total: Math.round((total.total + v.total) * 100) / 100 } }, { net: 0, tax: 0, total: 0 })
}
