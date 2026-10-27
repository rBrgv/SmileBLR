// Read-only aggregate reconciliation. Does not connect to Supabase or print patient details.
// node scripts/reconcile-handoff.mjs patients.csv [clinic-records.json]
import { readFileSync } from 'node:fs'
import { parseCSV, buildPatientRow } from '../apps/clinic/src/lib/patientImport.js'
const [csvPath, snapshotPath] = process.argv.slice(2)
if (!csvPath) throw new Error('Usage: node scripts/reconcile-handoff.mjs patients.csv [clinic-records.json]')
const rows = parseCSV(readFileSync(csvPath, 'utf8'))
const keys = rows.map(r => r.source_id).filter(Boolean)
const report = { source_rows: rows.length, unique_source_ids: new Set(keys).size, missing_source_ids: rows.length - keys.length, missing_phones: rows.filter(r => !r.phone).length, invalid_rows: [], populated_columns: {}, reconciliation: 'No app snapshot supplied; database migration completeness not verified.' }
for (const [i, r] of rows.entries()) {
  try { buildPatientRow(r); if (!r.full_name || (!r.phone && !r.source_id)) throw new Error('Missing identity') } catch { report.invalid_rows.push(i + 2) }
  for (const [key, value] of Object.entries(r)) if (value) report.populated_columns[key] = (report.populated_columns[key] || 0) + 1
}
if (snapshotPath) {
  const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8'))
  if (snapshot.format !== 'smileblr-records-v1' || !snapshot.tables?.patients) throw new Error('Expected an all-records JSON export from the app')
  const patients = snapshot.tables.patients
  const imported = new Map(patients.filter(p => p.import_key).map(p => [p.import_key, p]))
  const missing = [], changed = []
  rows.forEach((r, i) => {
    const p = imported.get('click4appointment:id:' + r.source_id)
    if (!p) missing.push(i + 2)
    else if (Object.entries(r).some(([k,v]) => p.import_source?.[k] !== v)) changed.push(i + 2)
  })
  report.reconciliation = { app_patients: patients.length, missing_source_rows: missing, changed_source_rows: changed, unknown_partial_payments: (snapshot.tables.invoices || []).filter(v => v.payment_status === 'partial' && v.amount_paid == null).length, exported_table_counts: snapshot.counts }
}
console.log(JSON.stringify(report, null, 2))
