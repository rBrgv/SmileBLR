import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { fmtD } from '../lib/format'
import { useToast } from '../components/Toast'
import Modal from '../components/Modal'
import { useRole } from '../lib/RoleContext'
import { ageLabel, patientAge } from '../lib/age'

export const TAG_OPTIONS = ['VIP', 'Pediatric', 'Anxious patient', 'Needs interpreter', 'Special needs']

export function PatientForm({ patient = {}, onDone, onClose }) {
  const [f, setF] = useState({
    full_name: patient.full_name || '', phone: patient.phone || '', email: patient.email || '',
    date_of_birth: patient.date_of_birth || '', gender: patient.gender || '', address: patient.address || '',
    emergency_contact_name: patient.emergency_contact_name || '', emergency_contact_phone: patient.emergency_contact_phone || '',
    referral_source: patient.referral_source || '', recall_interval_months: patient.recall_interval_months || 6,
    tags: patient.tags || [], consent_given: patient.consent_given || false, consent_date: patient.consent_date || null,
    age_today: patientAge(patient)?.age ?? '',
    manual_id: patient.manual_id || '',
  })
  const toast = useToast()
  const [similar, setSimilar] = useState([])
  const set = k => e => setF(x => ({ ...x, [k]: e.target.value }))

  // A warning, never a block: two real people do share a name, and reception
  // must not be stopped from registering the patient standing in front of them.
  useEffect(() => {
    const name = f.full_name.trim()
    if (patient.id || name.length < 3) { setSimilar([]); return }
    const timer = setTimeout(async () => {
      const { data } = await sb.from('patients')
        .select('id, full_name, patient_code, manual_id, phone, approx_age, approx_age_recorded_on, date_of_birth')
        .is('merged_into', null).ilike('full_name', name).limit(5)
      const typed = String(f.age_today).trim() === '' ? null : parseInt(f.age_today, 10)
      setSimilar((data ?? []).filter(c => {
        if (typed === null) return true
        const theirs = patientAge(c)?.age
        return theirs == null || Math.abs(theirs - typed) <= 2
      }))
    }, 300)
    return () => clearTimeout(timer)
  }, [f.full_name, f.age_today, patient.id])
  const toggleTag = t => setF(x => ({ ...x, tags: x.tags.includes(t) ? x.tags.filter(x2 => x2 !== t) : [...x.tags, t] }))

  async function save() {
    if (!f.full_name.trim()) return toast('A name is required.')
    const { age_today, ...fields } = f
    const rec = Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, typeof v === 'string' && !v.trim() ? null : v]))
    rec.recall_interval_months = parseInt(f.recall_interval_months) || 6
    // Only rewrite the age when it actually changed, so the recorded date
    // keeps meaning "the day someone last confirmed this".
    const typedAge = String(age_today).trim() === '' ? null : parseInt(age_today, 10)
    if (typedAge !== null && (!Number.isInteger(typedAge) || typedAge < 0 || typedAge > 120)) return toast('Enter an age between 0 and 120.')
    if (typedAge !== (patientAge(patient)?.age ?? null)) {
      rec.approx_age = typedAge
      rec.approx_age_recorded_on = typedAge === null ? null : new Date().toISOString().slice(0, 10)
    }
    let id = patient.id
    if (id) {
      const { error } = await sb.from('patients').update(rec).eq('id', id)
      if (error) return toast('Error: ' + error.message)
      toast('Patient updated')
    } else {
      rec.consent_date = rec.consent_given ? (rec.consent_date || new Date().toISOString()) : null
      const { data, error } = await sb.from('patients').insert(rec).select().single()
      if (error) return toast('Error: ' + error.message)
      id = data.id; toast('Patient created')
    }
    onDone(id)
  }

  return (
    <Modal title={(patient.id ? 'Edit' : 'New') + ' patient'} onClose={onClose}>
      <div className="mrow">
        <div>
          <label>Full name *</label><input value={f.full_name} onChange={set('full_name')} />
          {similar.length > 0 && (
            <div className="allergy-alert" style={{ marginTop: '.4rem' }}>
              Similar patient already registered — open it instead of creating a duplicate:
              {similar.map(c => (
                <div key={c.id}>
                  <b>{c.patient_code}</b> {c.full_name}
                  {patientAge(c) && <> · age {patientAge(c).age}</>}
                  {c.phone && c.phone !== 'N/A' && <> · {c.phone}</>}
                  {c.manual_id && <> · file {c.manual_id}</>}
                </div>
              ))}
            </div>
          )}
        </div>
        <div><label>Phone *</label><input value={f.phone} onChange={set('phone')} /></div>
      </div>
      <div className="mrow">
        <div><label>Email</label><input value={f.email} onChange={set('email')} /></div>
        <div><label>Age today</label><input type="number" min="0" max="120" placeholder="e.g. 47" value={f.age_today} onChange={set('age_today')} /></div>
        <div><label>Date of birth <span className="sub">(optional, overrides age)</span></label><input type="date" value={f.date_of_birth || ''} onChange={set('date_of_birth')} /></div>
        <div><label>Clinic file number <span className="sub">(optional)</span></label><input value={f.manual_id} onChange={set('manual_id')} placeholder="from the register book" /></div>
      </div>
      <div className="mrow">
        <div><label>Gender</label><select value={f.gender} onChange={set('gender')}>
          <option value="">—</option><option>Female</option><option>Male</option><option>Other</option></select></div>
        <div><label>Emergency contact</label><input placeholder="Name" value={f.emergency_contact_name} onChange={set('emergency_contact_name')} /></div>
      </div>
      <div className="mrow">
        <div><label>Emergency phone</label><input value={f.emergency_contact_phone} onChange={set('emergency_contact_phone')} /></div>
        <div></div>
      </div>
      <label>Address</label><textarea rows={2} value={f.address} onChange={set('address')} />
      <div className="mrow">
        <div><label>How did they hear about us?</label>
          <select value={f.referral_source} onChange={set('referral_source')}>
            <option value="">—</option>
            <option>Walk-in</option><option>Google search</option><option>Instagram / Facebook</option>
            <option>Friend / family referral</option><option>Existing patient referral</option>
            <option>Doctor referral</option><option>Other</option>
          </select>
        </div>
        <div><label>Recall interval</label>
          <select value={f.recall_interval_months} onChange={set('recall_interval_months')}>
            <option value="3">Every 3 months (perio maintenance)</option>
            <option value="6">Every 6 months (standard)</option>
            <option value="12">Every 12 months</option>
          </select>
        </div>
      </div>
      <label><input type="checkbox" style={{ width: 'auto' }} checked={f.consent_given} onChange={e => setF(x => ({ ...x, consent_given: e.target.checked, consent_date: e.target.checked ? new Date().toISOString() : null }))} /> Consent obtained from patient</label>
      <label>Tags</label>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.5rem', marginBottom: '1rem' }}>
        {TAG_OPTIONS.map(t => (
          <label key={t} style={{ display: 'flex', alignItems: 'center', gap: '.35rem', textTransform: 'none', fontSize: '.76rem', color: 'var(--ink)', border: '1px solid var(--rule)', borderRadius: 6, padding: '.3rem .6rem' }}>
            <input type="checkbox" style={{ width: 'auto' }} checked={f.tags.includes(t)} onChange={() => toggleTag(t)} /> {t}
          </label>
        ))}
      </div>
      <button className="btn" onClick={save}>Save patient</button>
    </Modal>
  )
}

export default function Patients() {
  const [rows, setRows] = useState(null)
  const [q, setQ] = useState('')
  const [showForm, setShowForm] = useState(false)
  const role = useRole()
  const toast = useToast()
  const [page, setPage] = useState(0)
  const [count, setCount] = useState(0)
  const [sort, setSort] = useState({ field: 'created_at', asc: false })
  // Neither a birth date nor an age from the old system: the front desk has to
  // ask these patients at their next visit.
  const [missingAge, setMissingAge] = useState(false)
  const [missingPhone, setMissingPhone] = useState(false)
  const nav = useNavigate()

  function toggleSort(field) {
    setPage(0)
    setSort(s => s.field === field ? { field, asc: !s.asc } : { field, asc: true })
  }
  function arrow(field) { return sort.field === field ? (sort.asc ? ' ▲' : ' ▼') : '' }

  useEffect(() => {
    let active = true
    const timer = setTimeout(async () => {
      let query = sb.from('patients').select('*', { count: 'exact' }).is('merged_into', null).order(sort.field, { ascending: sort.asc }).order('id')
      const term = q.trim().replace(/[\\%_]/g, c => '\\' + c)
      if (term) {
        const pattern = JSON.stringify('%' + term + '%')
        query = query.or(`full_name.ilike.${pattern},phone.ilike.${pattern},patient_code.ilike.${pattern},manual_id.ilike.${pattern}`)
      }
      if (missingAge) query = query.is('date_of_birth', null).is('approx_age', null)
      // 'N/A' is the placeholder the first import wrote for a missing number.
      if (missingPhone) query = query.or('phone.is.null,phone.eq.N/A')
      const { data, error, count } = await query.range(page * 50, page * 50 + 49)
      if (!active) return
      if (error) { toast('Patient search failed: ' + error.message); setRows([]); return }
      setRows(data || []); setCount(count || 0)
    }, 250)
    return () => { active = false; clearTimeout(timer) }
  }, [q, page, sort, missingAge, missingPhone])

  const view = rows || []

  return (
    <>
      <div className="pagehead">
        <h2>Patients</h2>
        <div>
          {role === 'admin' && <button className="btn ghost" onClick={() => nav('/patient-import')}>Import CSV</button>}{' '}
          <button className="btn" onClick={() => setShowForm(true)}>+ New patient</button>
        </div>
      </div>
      <div className="bar">
        <input placeholder="Search name, phone, patient ID…" value={q} onChange={e => { setQ(e.target.value); setPage(0) }} />
        <label style={{ whiteSpace: 'nowrap' }}>
          <input type="checkbox" style={{ width: 'auto', marginRight: '.4rem' }}
            checked={missingAge} onChange={e => { setMissingAge(e.target.checked); setPage(0) }} />
          No age
        </label>
        <label style={{ whiteSpace: 'nowrap' }}>
          <input type="checkbox" style={{ width: 'auto', marginRight: '.4rem' }}
            checked={missingPhone} onChange={e => { setMissingPhone(e.target.checked); setPage(0) }} />
          No phone
        </label>
      </div>
      {!view.length ? <div className="empty">{rows === null ? 'Loading…' : 'No matching patients.'}</div> : (
        <table className="tbl">
          <thead><tr>
            <th className="sortable" onClick={() => toggleSort('patient_code')}>ID{arrow('patient_code')}</th>
            <th className="sortable" onClick={() => toggleSort('full_name')}>Name{arrow('full_name')}</th>
            <th className="sortable" onClick={() => toggleSort('phone')}>Phone{arrow('phone')}</th>
            <th className="sortable" onClick={() => toggleSort('approx_age')}>Age{arrow('approx_age')}</th>
            <th className="sortable" onClick={() => toggleSort('created_at')}>Registered{arrow('created_at')}</th>
            <th></th>
          </tr></thead>
          <tbody>{view.map(p => (
            <tr key={p.id}>
              <td className="sub">{p.patient_code}{p.manual_id && <><br />{p.manual_id}</>}</td>
              <td className="link" onClick={() => nav('/patients/' + p.id)}>
                {p.full_name}
                {(p.tags || []).map(t => <span key={t} className="badge b-partial" style={{ marginLeft: '.4rem' }}>{t}</span>)}
              </td>
              <td>{p.phone && p.phone !== 'N/A' ? p.phone : <span className="badge b-partial">no phone</span>}</td>
              <td>{ageLabel(p) ?? <span className="sub">not recorded</span>}</td>
              <td>{fmtD(p.created_at)}</td>
              <td><button className="btn sm ghost" onClick={() => nav('/patients/' + p.id)}>Open</button></td>
            </tr>
          ))}</tbody>
        </table>
      )}
      {showForm && <PatientForm onClose={() => setShowForm(false)} onDone={id => { setShowForm(false); nav('/patients/' + id) }} />}
      <div className="bar"><button className="btn ghost" disabled={!page} onClick={() => setPage(p => p - 1)}>Previous</button><span>Page {page + 1} · {count} patients</span><button className="btn ghost" disabled={(page + 1) * 50 >= count} onClick={() => setPage(p => p + 1)}>Next</button></div>
    </>
  )
}
