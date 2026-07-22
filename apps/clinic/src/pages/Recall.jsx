import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { fmtD, digits, today } from '../lib/format'
import { useToast } from '../components/Toast'

export default function Recall() {
  const [rows, setRows] = useState(null)
  const toast = useToast()
  const nav = useNavigate()

  async function load() {
    const { data, error } = await sb.from('recall_reminders').select('*, patients(full_name,phone)')
      .order('recall_due_date').limit(300)
    if (error) return toast('Error: ' + error.message)
    setRows(data)
  }
  useEffect(() => { load() }, [])

  async function markSent(id) {
    await sb.from('recall_reminders').update({ reminder_sent: true, reminder_sent_date: new Date().toISOString() }).eq('id', id)
    setTimeout(load, 600)
  }

  if (!rows) return <div className="empty">Loading…</div>
  const t = today()

  return (
    <>
      <div className="pagehead"><h2>Recall reminders</h2></div>
      <p style={{ fontSize: '.74rem', color: 'var(--mid)', marginBottom: '1rem' }}>
        Created automatically when an appointment is marked completed (due 6 months later).
      </p>
      {!rows.length ? <div className="empty">No recalls yet.</div> : (
        <table className="tbl">
          <thead><tr><th>Patient</th><th>Last visit</th><th>Due</th><th>Sent</th><th></th></tr></thead>
          <tbody>{rows.map(r => {
            const due = r.recall_due_date <= t && !r.reminder_sent
            const msg = encodeURIComponent(`Hi ${r.patients?.full_name || ''}, this is Smile Bengaluru. It has been 6 months since your last visit — time for your routine dental check-up. Reply here to book a convenient slot.`)
            return (
              <tr key={r.id}>
                <td className="link" onClick={() => nav('/patients/' + r.patient_id)}>{r.patients?.full_name}</td>
                <td>{fmtD(r.last_visit_date)}</td>
                <td className={due ? 'low' : ''}>{fmtD(r.recall_due_date)}{due && ' · DUE'}</td>
                <td>{r.reminder_sent ? '✓ ' + fmtD(r.reminder_sent_date) : '—'}</td>
                <td>{!r.reminder_sent && (
                  <a className="btn sm green" target="_blank" rel="noreferrer"
                    href={`https://wa.me/${digits(r.patients?.phone)}?text=${msg}`}
                    onClick={() => markSent(r.id)}>Send WA</a>
                )}</td>
              </tr>
            )
          })}</tbody>
        </table>
      )}
    </>
  )
}
