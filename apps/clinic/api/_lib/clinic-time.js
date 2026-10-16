// Vercel functions run in UTC, but appointment times, "tomorrow", clinic hours
// and bot slot times are all clinic-local (IST) — the same assumption the
// browser app and `npm test` (TZ=Asia/Kolkata) make. Pinning the process
// timezone at import keeps server-side Date math and toLocale* output in IST.
// Import this from every API module that works with local dates or times.
process.env.TZ = 'Asia/Kolkata'

// The clinic's current day as YYYY-MM-DD (toISOString() would give the UTC day).
export function todayLocal() {
  return new Date().toLocaleDateString('en-CA')
}
