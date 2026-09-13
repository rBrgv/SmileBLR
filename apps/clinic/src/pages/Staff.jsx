import { useEffect, useState } from 'react'
import { sb } from '../lib/supabase'
import { fmtD, today } from '../lib/format'
import { useToast } from '../components/Toast'
import Modal from '../components/Modal'
import { useRole } from '../lib/RoleContext'
import { logActivity } from '../lib/activityLog'

export default function Staff() {
  const [rows, setRows] = useState(null)
  const [show, setShow] = useState(false)
  const [invite, setInvite] = useState(null) // staff row being invited
  const [leave, setLeave] = useState(null) // staff row whose leave is being managed
  const toast = useToast()
  const role = useRole()
  const isAdmin = role === 'admin'

  async function load() {
    const { data } = await sb.from('staff').select('*').order('full_name')
    setRows(data ?? [])
  }
  useEffect(() => { load() }, [])

  async function toggle(id, active) {
    const { error } = await sb.from('staff').update({ active }).eq('id', id)
    if (error) return toast('Error: ' + error.message)
    const s = rows.find(r => r.id === id)
    logActivity(active ? 'staff.activated' : 'staff.deactivated', 'staff', id, `${s?.full_name || 'A staff member'} was ${active ? 'activated' : 'deactivated'}`)
    toast('Updated'); load()
  }

  if (!rows) return <div className="empty">Loading…</div>
  return (
    <>
      <div className="pagehead">
        <h2>Staff</h2>
        {isAdmin && <button className="btn" onClick={() => setShow(true)}>+ Add staff</button>}
      </div>
      {!isAdmin && (
        <p style={{ fontSize: '.74rem', color: 'var(--mid)', marginBottom: '1rem' }}>
          Only admins can add staff, change roles, or invite logins.
        </p>
      )}
      {!rows.length ? (
        <div className="empty">Add Dr. Prithvi and the team here first — doctors appear in appointment and prescription dropdowns.</div>
      ) : (
        <table className="tbl">
          <thead><tr><th>Name</th><th>Role</th><th>Specialization</th><th>Floor</th><th>Phone</th><th>Login</th><th>Active</th><th></th></tr></thead>
          <tbody>{rows.map(s => (
            <tr key={s.id}>
              <td>{s.full_name}</td><td>{s.role}</td><td>{s.specialization || '—'}</td>
              <td>{s.floor_assigned ?? '—'}</td><td>{s.phone || '—'}</td>
              <td>{s.user_id ? <span className="badge b-completed">linked</span> : <span className="badge b-cancelled">no login</span>}</td>
              <td><input type="checkbox" style={{ width: 'auto' }} checked={s.active} disabled={!isAdmin} onChange={e => toggle(s.id, e.target.checked)} /></td>
              <td>
                {s.role === 'doctor' && <button className="btn sm ghost" onClick={() => setLeave(s)}>Leave</button>}{' '}
                {isAdmin && !s.user_id && <button className="btn sm ghost" onClick={() => setInvite(s)}>Invite login</button>}
              </td>
            </tr>
          ))}</tbody>
        </table>
      )}
      {show && <StaffForm onClose={() => setShow(false)} onDone={() => { setShow(false); load() }} />}
      {invite && <InviteForm staff={invite} onClose={() => setInvite(null)} onDone={() => { setInvite(null); load() }} />}
      {leave && <LeaveForm staff={leave} onClose={() => setLeave(null)} />}
    </>
  )
}

function LeaveForm({ staff, onClose }) {
  const [rows, setRows] = useState(null)
  const [date, setDate] = useState(today())
  const [reason, setReason] = useState('')
  const toast = useToast()

  async function load() {
    const { data, error } = await sb.from('staff_leave').select('*').eq('staff_id', staff.id)
      .gte('leave_date', today()).order('leave_date')
    if (error) { toast('Error: ' + error.message); return setRows([]) }
    setRows(data ?? [])
  }
  useEffect(() => { load() }, [])

  async function add() {
    if (!date) return toast('Pick a date.')
    const { error } = await sb.from('staff_leave').insert({ staff_id: staff.id, leave_date: date, reason: reason.trim() || null })
    if (error) return toast('Error: ' + error.message)
    toast('Leave added'); setReason(''); load()
  }
  async function remove(id) {
    const { error } = await sb.from('staff_leave').delete().eq('id', id)
    if (error) return toast('Error: ' + error.message)
    load()
  }

  return (
    <Modal title={'Leave — ' + staff.full_name} onClose={onClose}>
      <p style={{ fontSize: '.78rem', color: 'var(--mid)', marginBottom: '.75rem' }}>
        Upcoming leave days are checked when booking an appointment with this doctor.
      </p>
      <div className="mrow">
        <div><label>Date</label><input type="date" value={date} onChange={e => setDate(e.target.value)} /></div>
        <div><label>Reason (optional)</label><input value={reason} onChange={e => setReason(e.target.value)} /></div>
      </div>
      <button className="btn sm" style={{ marginTop: '.5rem' }} onClick={add}>+ Add leave day</button>
      {rows === null ? <p style={{ marginTop: '1rem', fontSize: '.78rem' }}>Loading…</p> : !rows.length ? (
        <p style={{ marginTop: '1rem', fontSize: '.78rem', color: 'var(--soft)' }}>No upcoming leave on record.</p>
      ) : (
        <table className="tbl" style={{ marginTop: '1rem' }}>
          <thead><tr><th>Date</th><th>Reason</th><th></th></tr></thead>
          <tbody>{rows.map(r => (
            <tr key={r.id}>
              <td>{fmtD(r.leave_date)}</td><td>{r.reason || '—'}</td>
              <td><button className="btn sm ghost danger" onClick={() => remove(r.id)}>Remove</button></td>
            </tr>
          ))}</tbody>
        </table>
      )}
    </Modal>
  )
}

function StaffForm({ onClose, onDone }) {
  const [f, setF] = useState({ full_name: '', role: 'doctor', floor_assigned: '', specialization: '', qualifications: '', phone: '', email: '' })
  const toast = useToast()
  const set = k => e => setF(x => ({ ...x, [k]: e.target.value }))
  async function save() {
    if (!f.full_name.trim()) return toast('Name required.')
    const { error } = await sb.from('staff').insert({
      full_name: f.full_name.trim(), role: f.role,
      specialization: f.specialization.trim() || null, qualifications: f.qualifications.trim() || null,
      floor_assigned: parseInt(f.floor_assigned) || null, phone: f.phone.trim() || null, email: f.email.trim() || null,
    })
    if (error) return toast('Error: ' + error.message)
    toast('Staff added'); onDone()
  }
  return (
    <Modal title="Add staff member" onClose={onClose}>
      <label>Full name *</label><input value={f.full_name} onChange={set('full_name')} />
      <div className="mrow">
        <div><label>Role</label><select value={f.role} onChange={set('role')}>
          {['doctor', 'receptionist', 'assistant', 'admin'].map(r => <option key={r}>{r}</option>)}</select></div>
        <div><label>Floor</label><input type="number" value={f.floor_assigned} onChange={set('floor_assigned')} /></div>
      </div>
      <label>Specialization</label><input placeholder="Oral & Maxillofacial Surgery" value={f.specialization} onChange={set('specialization')} />
      <label>Qualifications</label><input placeholder="MDS, MOMS RCPS Glasgow" value={f.qualifications} onChange={set('qualifications')} />
      <div className="mrow">
        <div><label>Phone</label><input value={f.phone} onChange={set('phone')} /></div>
        <div><label>Email</label><input value={f.email} onChange={set('email')} /></div>
      </div>
      <button className="btn" onClick={save}>Save</button>
    </Modal>
  )
}

function InviteForm({ staff, onClose, onDone }) {
  const [email, setEmail] = useState(staff.email || '')
  const [busy, setBusy] = useState(false)
  const toast = useToast()

  async function send() {
    if (!email.trim()) return toast('Email required.')
    setBusy(true)
    const { data: { session } } = await sb.auth.getSession()
    let res, data
    try {
      res = await fetch('/api/staff-invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + session.access_token },
        body: JSON.stringify({ email: email.trim(), full_name: staff.full_name, role: staff.role }),
      })
      data = await res.json().catch(() => ({}))
    } catch (e) {
      setBusy(false); return toast('Error: could not reach the invite endpoint.')
    }
    setBusy(false)
    if (!res.ok) return toast('Error: ' + (data.error || res.statusText))
    logActivity('staff.invited', 'staff', staff.id, `Invited ${staff.full_name} (${staff.role}) to sign in as ${email}`)
    toast('Invite sent to ' + email); onDone()
  }

  return (
    <Modal title={'Invite login — ' + staff.full_name} onClose={onClose}>
      <p style={{ fontSize: '.78rem', color: 'var(--mid)', marginBottom: '.5rem' }}>
        Sends an email invite so {staff.full_name} can set a password and sign in as "{staff.role}".
      </p>
      <label>Email *</label><input type="email" value={email} onChange={e => setEmail(e.target.value)} />
      <button className="btn" disabled={busy} onClick={send}>{busy ? 'Sending…' : 'Send invite'}</button>
    </Modal>
  )
}
