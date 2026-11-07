import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { waLink } from '../lib/share'
import { fmtDT } from '../lib/format'
import { groupConversations, maskPhone } from '../lib/conversations'
import { useRole } from '../lib/RoleContext'
import { useToast } from '../components/Toast'
import Modal from '../components/Modal'

// Who has messaged the clinic's WhatsApp number, and what the assistant said.
// Read-only: the assistant answers on its own, and staff reply from the phone.
export default function WhatsAppInbox() {
  const [rows, setRows] = useState(null)
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(null) // conversation being read
  const toast = useToast()
  const nav = useNavigate()
  const isAdmin = useRole() === 'admin'

  async function load() {
    const { data, error } = await sb.from('wa_messages').select('*, patients(full_name)')
      .order('created_at', { ascending: false }).limit(2000)
    if (error) return toast('Error: ' + error.message)
    setRows(data ?? [])
  }
  useEffect(() => { if (isAdmin) load() }, [isAdmin])

  const people = useMemo(() => rows ? groupConversations(rows) : [], [rows])
  if (!isAdmin) return <div className="empty">Only admins can read WhatsApp conversations.</div>
  if (!rows) return <div className="empty">Loading…</div>

  const needle = q.trim().toLowerCase()
  const view = people.filter(c => !needle
    || (c.patient || '').toLowerCase().includes(needle)
    || c.phone.includes(needle.replace(/\D/g, '') || '\u0000')
    || (c.last.body || '').toLowerCase().includes(needle))

  return (
    <>
      <div className="pagehead"><h2>WhatsApp conversations</h2><button className="btn ghost" onClick={load}>Refresh</button></div>
      <p style={{ fontSize: '.74rem', color: 'var(--mid)', marginBottom: '1rem' }}>
        Everyone who has messaged the clinic number since the assistant was switched on. Messages that need a person also appear on Bookings.
      </p>
      <div className="bar"><input placeholder="Search name, number or message…" value={q} onChange={e => setQ(e.target.value)} /></div>
      {!view.length ? <div className="empty">{people.length ? 'No conversation matches.' : 'No one has messaged yet.'}</div> : (
        <table className="tbl">
          <thead><tr><th>Who</th><th>Last message</th><th>When</th><th>Messages</th><th></th></tr></thead>
          <tbody>{view.map(c => (
            <tr key={c.phone}>
              <td>
                {c.patientId
                  ? <span className="link" onClick={() => nav('/patients/' + c.patientId)}>{c.patient || 'Patient'}</span>
                  : <b>Not a patient</b>}
                <br /><span style={{ color: 'var(--soft)' }}>{maskPhone(c.phone)}</span>
              </td>
              <td style={{ maxWidth: '22rem' }}>
                <span style={{ color: 'var(--soft)' }}>{c.last.direction === 'in' ? 'They: ' : 'Assistant: '}</span>
                {(c.last.body || '').slice(0, 140)}
                {c.unanswered && <> <span className="badge b-pending">no reply yet</span></>}
              </td>
              <td>{fmtDT(c.last.created_at)}</td>
              <td>{c.count}</td>
              <td>
                <button className="btn sm ghost" onClick={() => setOpen(c)}>Read</button>{' '}
                {waLink(c.phone) && <a className="btn sm green" target="_blank" rel="noreferrer" href={waLink(c.phone)}>Reply</a>}
              </td>
            </tr>
          ))}</tbody>
        </table>
      )}
      {open && <Thread convo={open} messages={rows.filter(m => m.phone === open.phone).reverse()} onClose={() => setOpen(null)} />}
    </>
  )
}

function Thread({ convo, messages, onClose }) {
  return (
    <Modal title={(convo.patient || 'Not a patient') + ' · ' + maskPhone(convo.phone)} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem', maxHeight: '60vh', overflowY: 'auto' }}>
        {messages.map(m => (
          <div key={m.id} style={{
            alignSelf: m.direction === 'in' ? 'flex-start' : 'flex-end', maxWidth: '85%',
            background: m.direction === 'in' ? 'var(--cream)' : '#fff', border: '1px solid var(--rule)',
            borderRadius: 8, padding: '.5rem .7rem', fontSize: '.8rem', whiteSpace: 'pre-wrap',
          }}>
            {m.body}
            <div style={{ fontSize: '.62rem', color: 'var(--soft)', marginTop: '.2rem' }}>
              {m.direction === 'in' ? 'Patient' : 'Assistant'} · {fmtDT(m.created_at)}
            </div>
          </div>
        ))}
      </div>
      {waLink(convo.phone) && <p style={{ marginTop: '.75rem' }}><a className="btn sm green" target="_blank" rel="noreferrer" href={waLink(convo.phone)}>Reply on WhatsApp</a></p>}
    </Modal>
  )
}
