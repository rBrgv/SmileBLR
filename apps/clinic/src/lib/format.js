export const fmtD = d => d ? new Date(d).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'}) : '—'
export const fmtT = d => d ? new Date(d).toLocaleTimeString('en-IN',{hour:'numeric',minute:'2-digit'}) : '—'
export const fmtDT = d => d ? `${new Date(d).toLocaleDateString('en-IN',{day:'numeric',month:'short'})} · ${fmtT(d)}` : '—'
export const inr = n => n == null ? '—' : '₹' + Number(n).toLocaleString('en-IN')
export const digits = s => (s || '').replace(/\D/g, '')
// Local calendar date, not toISOString() — that round-trips through UTC and
// reports yesterday's date between midnight and ~5:30am in timezones ahead
// of UTC (e.g. IST).
export const today = () => {
  const d = new Date()
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}
