// Patients entered twice are found by name. Spelling, spacing and case are
// ignored ("Asha  Rao" and "asha rao" are the same name), but only exact names
// are grouped: "Mohd" and "Mohammed" are different strings, and guessing that
// they are one person is for a human, not for this screen. Two people can
// genuinely share a name, so every row shows what tells them apart.
export const normaliseName = name => String(name ?? '').toLowerCase().replace(/[^\p{L}]/gu, '')

const dataTotal = c => Object.values(c ?? {}).reduce((a, n) => a + n, 0)

export function describeData(counts) {
  const parts = [
    [counts?.records, 'treatment', 'treatments'], [counts?.bills, 'bill', 'bills'], [counts?.appointments, 'appointment', 'appointments'],
    [counts?.prescriptions, 'prescription', 'prescriptions'], [counts?.consultations, 'consultation', 'consultations'], [counts?.consents, 'consent form', 'consent forms'],
  ].filter(([n]) => n > 0).map(([n, one, many]) => `${n} ${n === 1 ? one : many}`)
  return parts.length ? parts.join(' · ') : 'nothing recorded'
}

// patients: rows with id, full_name, created_at. countsById: id -> {records, bills, ...}.
// The suggested record to keep is the one with the most recorded against it,
// then the one registered first, so the history stays where it already is.
export function duplicateGroups(patients, countsById = {}) {
  const byName = new Map()
  for (const p of patients) {
    const key = normaliseName(p.full_name)
    if (!key) continue
    if (!byName.has(key)) byName.set(key, [])
    byName.get(key).push({ ...p, counts: countsById[p.id] ?? {}, data: dataTotal(countsById[p.id]) })
  }
  return [...byName.entries()]
    .filter(([, members]) => members.length > 1)
    .map(([key, members]) => {
      members.sort((a, b) => b.data - a.data || String(a.created_at).localeCompare(String(b.created_at)))
      return { key, name: String(members[0].full_name).replace(/\s+/g, ' ').trim(), members, keep: members[0].id }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}
