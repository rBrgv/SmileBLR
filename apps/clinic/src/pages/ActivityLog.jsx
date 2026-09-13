import { useEffect, useState } from 'react'
import { sb } from '../lib/supabase'
import { fmtDT } from '../lib/format'
import { useToast } from '../components/Toast'
import { useRole } from '../lib/RoleContext'

export default function ActivityLog() {
  const [rows, setRows] = useState(null)
  const toast = useToast()
  const role = useRole()
  const isAdmin = role === 'admin'

  async function load() {
    const { data, error } = await sb.from('activity_log').select('*, staff(full_name)')
      .order('created_at', { ascending: false }).limit(300)
    if (error) { toast('Error: ' + error.message); return setRows([]) }
    setRows(data ?? [])
  }
  useEffect(() => { load() }, [])

  if (!isAdmin) return <div className="empty">Only admins can view the activity log.</div>
  if (!rows) return <div className="empty">Loading…</div>

  return (
    <>
      <div className="pagehead"><h2>Activity log</h2></div>
      <p style={{ fontSize: '.74rem', color: 'var(--mid)', marginBottom: '1rem' }}>
        A record of staff/role changes, permanent deletions, treatment plan approvals, and consent signings.
        This log cannot be edited or deleted from the app.
      </p>
      {!rows.length ? <div className="empty">No activity recorded yet.</div> : (
        <table className="tbl">
          <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Details</th></tr></thead>
          <tbody>{rows.map(r => (
            <tr key={r.id}>
              <td>{fmtDT(r.created_at)}</td>
              <td>{r.staff?.full_name || '—'}</td>
              <td>{r.action}</td>
              <td>{r.summary}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
    </>
  )
}
