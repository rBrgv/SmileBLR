import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { fmtD } from '../lib/format'
import { useToast } from '../components/Toast'
import Modal from '../components/Modal'
import { useRole } from '../lib/RoleContext'

export const TAG_OPTIONS = ['VIP', 'Pediatric', 'Anxious patient', 'Needs interpreter', 'Special needs']

export function PatientForm({ patient = {}, onDone, onClose }) {
  const [f, setF] = useState({
    full_name: patient.full_name || '', phone: patient.phone || '', email: patient.email || '',
    date_of_birth: patient.date_of_birth || '', gender: patient.gender || '', address: patient.address || '',
    emergency_contact_name: patient.emergency_contact_name || '', emergency_contact_phone: patient.emergency_contact_phone || '',
    referral_source: patient.referral_source || '', recall_interval_months: patient.recall_interval_months || 6,
    tags: patient.tags || [], consent_given: patient.consent_given || false, consent_date: patient.consent_date || null,
  })
  const toast = useToast()
  const set = k => e => setF(x => ({ ...x, [k]: e.target.value }))
  const toggleTag = t => setF(x => ({ ...x, tags: x.tags.includes(t) ? x.tags.filter(x2 => x2 !== t) : [...x.tags, t] }))

  async function save() {
    if (!f.full_name.trim() || (!patient.id && !f.phone.trim())) return toast('Name and phone are required.')
    const rec = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, typeof v === 'string' && !v.trim() ? null : v]))
    rec.recall_interval_months = parseInt(f.recall_interval_months) || 6
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
        <div><label>Full name *</label><input value={f.full_name} onChange={set('full_name')} /></div>
        <div><label>Phone *</label><input value={f.phone} onChange={set('phone')} /></div>
      </div>
      <div className="mrow">
        <div><label>Email</label><input value={f.email} onChange={set('email')} /></div>
        <div><label>Date of birth</label><input type="date" value={f.date_of_birth || ''} onChange={set('date_of_birth')} /></div>
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
        query = query.or(`full_name.ilike.${pattern},phone.ilike.${pattern}`)
      }
      if (missingAge) query = query.is('date_of_birth', null).is('approx_age', null)
      const { data, error, count } = await query.range(page * 50, page * 50 + 49)
      if (!active) return
      if (error) { toast('Patient search failed: ' + error.message); setRows([]); return }
      setRows(data || []); setCount(count || 0)
    }, 250)
    return () => { active = false; clearTimeout(timer) }
  }, [q, page, sort, missingAge])

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
        <input placeholder="Search name / phone…" value={q} onChange={e => { setQ(e.target.value); setPage(0) }} />
        <label style={{ whiteSpace: 'nowrap' }}>
          <input type="checkbox" style={{ width: 'auto', marginRight: '.4rem' }}
            checked={missingAge} onChange={e => { setMissingAge(e.target.checked); setPage(0) }} />
          No date of birth or age
        </label>
      </div>
      {!view.length ? <div className="empty">{rows === null ? 'Loading…' : 'No matching patients.'}</div> : (
        <table className="tbl">
          <thead><tr>
            <th className="sortable" onClick={() => toggleSort('full_name')}>Name{arrow('full_name')}</th>
            <th className="sortable" onClick={() => toggleSort('phone')}>Phone{arrow('phone')}</th>
            <th className="sortable" onClick={() => toggleSort('date_of_birth')}>DOB{arrow('date_of_birth')}</th>
            <th className="sortable" onClick={() => toggleSort('created_at')}>Registered{arrow('created_at')}</th>
            <th></th>
          </tr></thead>
          <tbody>{view.map(p => (
            <tr key={p.id}>
              <td className="link" onClick={() => nav('/patients/' + p.id)}>
                {p.full_name}
                {(p.tags || []).map(t => <span key={t} className="badge b-partial" style={{ marginLeft: '.4rem' }}>{t}</span>)}
              </td>
              <td>{p.phone}</td>
              <td>{p.date_of_birth ? fmtD(p.date_of_birth)
                : p.approx_age != null ? <span title={'Age recorded ' + fmtD(p.approx_age_recorded_on)}>Age {p.approx_age}</span>
                : <span className="sub">not recorded</span>}</td>
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
