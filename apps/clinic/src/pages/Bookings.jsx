import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { fmtDT, digits } from '../lib/format'
import { useToast } from '../components/Toast'
import StatusSelect from '../components/StatusSelect'

const STATUSES = ['new', 'confirmed', 'completed', 'cancelled']

export default function Bookings() {
  const [rows, setRows] = useState(null)
  const [q, setQ] = useState('')
  const [st, setSt] = useState('')
  const toast = useToast()
  const nav = useNavigate()

  async function load() {
    const { data, error } = await sb.from('bookings').select('*').order('created_at', { ascending: false }).limit(300)
    if (error) return toast('Error: ' + error.message)
    setRows(data)
  }
  useEffect(() => { load() }, [])

  async function setStatus(id, status) {
    const { error } = await sb.from('bookings').update({ status }).eq('id', id)
    if (error) return toast('Error: ' + error.message)
    toast('Booking updated'); load()
  }

  async function convert(b) {
    const { data: existing } = await sb.from('patients').select('id').eq('phone', b.phone).limit(1)
    if (existing?.length) { toast('Patient with this phone already exists.'); return nav('/patients/' + existing[0].id) }
    const { data: p, error } = await sb.from('patients').insert({
      full_name: b.patient_name, phone: b.phone, consent_given: true,
      consent_date: new Date().toISOString(), booking_id: b.id,
    }).select().single()
    if (error) return toast('Error: ' + error.message)
    await sb.from('bookings').update({ status: 'confirmed' }).eq('id', b.id)
    toast('Patient created'); nav('/patients/' + p.id)
  }

  if (!rows) return <div className="empty">Loading…</div>
  const view = rows.filter(b =>
    (!q || (b.patient_name || '').toLowerCase().includes(q.toLowerCase()) || (b.phone || '').includes(q)) &&
    (!st || b.status === st))

  return (
    <>
      <div className="pagehead"><h2>Bookings</h2></div>
      <div className="bar">
        <input placeholder="Search name / phone…" value={q} onChange={e => setQ(e.target.value)} />
        <select value={st} onChange={e => setSt(e.target.value)}>
          <option value="">All statuses</option>
          {STATUSES.map(s => <option key={s}>{s}</option>)}
        </select>
      </div>
      {!view.length ? <div className="empty">No bookings.</div> : (
        <table className="tbl">
          <thead><tr><th>Received</th><th>Patient</th><th>Reason</th><th>Source</th><th>Status</th><th></th></tr></thead>
          <tbody>{view.map(b => (
            <tr key={b.id}>
              <td>{fmtDT(b.created_at)}</td>
              <td><b>{b.patient_name}</b><br /><a href={'tel:' + b.phone} style={{ color: 'var(--purple)' }}>{b.phone}</a></td>
              <td>{b.reason || '—'}{b.preferred_day && <><br /><small style={{ color: 'var(--soft)' }}>Prefers: {b.preferred_day}</small></>}</td>
              <td>{b.lead_source}</td>
              <td><StatusSelect value={b.status} options={STATUSES} onChange={s => setStatus(b.id, s)} /></td>
              <td>
                <button className="btn sm pink" onClick={() => convert(b)}>→ Patient</button>{' '}
                <a className="btn sm ghost" target="_blank" rel="noreferrer" href={'https://wa.me/' + digits(b.phone)}>WA</a>
              </td>
            </tr>
          ))}</tbody>
        </table>
      )}
    </>
  )
}
