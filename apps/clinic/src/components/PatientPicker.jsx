import { useEffect, useState } from 'react'
import { sb } from '../lib/supabase'
import { PatientForm } from '../pages/Patients'

const COLUMNS = 'id, full_name, phone, patient_code, manual_id'

// Choose a patient by searching, or register a new one without leaving the
// form. It replaces a dropdown of every patient, whose first entry was
// preselected: saving without looking booked the visit for whoever sorted first.
export default function PatientPicker({ value, onChange, locked = false }) {
  const [selected, setSelected] = useState(null)
  const [q, setQ] = useState('')
  const [results, setResults] = useState([])
  const [searched, setSearched] = useState(false)
  const [showNew, setShowNew] = useState(false)

  // A patient already chosen (booking from their page, or editing a visit).
  useEffect(() => {
    if (!value || selected?.id === value) return
    sb.from('patients').select(COLUMNS).eq('id', value).maybeSingle().then(({ data }) => data && setSelected(data))
  }, [value])

  useEffect(() => {
    const term = q.trim().replace(/[\\%_]/g, c => '\\' + c)
    if (!term) { setResults([]); setSearched(false); return }
    let active = true
    const timer = setTimeout(async () => {
      const pattern = JSON.stringify('%' + term + '%')
      const { data } = await sb.from('patients').select(COLUMNS).is('merged_into', null).is('deleted_at', null)
        .or(`full_name.ilike.${pattern},phone.ilike.${pattern},patient_code.ilike.${pattern},manual_id.ilike.${pattern}`)
        .order('full_name').limit(8)
      if (active) { setResults(data ?? []); setSearched(true) }
    }, 250)
    return () => { active = false; clearTimeout(timer) }
  }, [q])

  function pick(p) { setSelected(p); setQ(''); setResults([]); onChange(p.id) }
  async function created(id) {
    setShowNew(false)
    const { data } = await sb.from('patients').select(COLUMNS).eq('id', id).maybeSingle()
    if (data) pick(data)
  }

  if (value && selected) {
    return (
      <div className="allergy-alert" style={{ background: 'var(--cream)', color: 'var(--ink)', borderColor: 'var(--rule)', display: 'flex', justifyContent: 'space-between', gap: '.75rem', alignItems: 'center' }}>
        <span><b>{selected.full_name}</b> · {selected.patient_code}{selected.manual_id ? ' · file ' + selected.manual_id : ''}{selected.phone ? ' · ' + selected.phone : ''}</span>
        {!locked && <button type="button" className="btn sm ghost" onClick={() => { setSelected(null); onChange('') }}>Change</button>}
      </div>
    )
  }

  return (
    <>
      <input placeholder="Search name, phone, patient ID or file number…" value={q} onChange={e => setQ(e.target.value)} autoFocus />
      {results.map(p => (
        <button type="button" key={p.id} className="btn ghost" style={{ display: 'block', width: '100%', textAlign: 'left', marginTop: '.25rem' }} onClick={() => pick(p)}>
          <b>{p.full_name}</b> <span className="sub">{p.patient_code}{p.manual_id ? ' · file ' + p.manual_id : ''}{p.phone ? ' · ' + p.phone : ''}</span>
        </button>
      ))}
      {searched && !results.length && <p className="sub" style={{ marginTop: '.4rem' }}>No patient matches “{q.trim()}”.</p>}
      <button type="button" className="btn sm" style={{ marginTop: '.5rem' }} onClick={() => setShowNew(true)}>+ New patient</button>
      {showNew && <PatientForm onClose={() => setShowNew(false)} onDone={created} />}
    </>
  )
}
