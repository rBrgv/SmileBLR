import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { fmtT, fmtD } from '../lib/format'
import PrintDoc from '../components/PrintDoc'

export default function PrintDaySheet() {
  const { date } = useParams()
  const [rows, setRows] = useState(null)

  useEffect(() => {
    const from = new Date(date + 'T00:00:00')
    const to = new Date(from); to.setDate(to.getDate() + 1)
    sb.from('appointments').select('*, patients(full_name,phone), staff(full_name), treatments(name)')
      .gte('appointment_time', from.toISOString()).lt('appointment_time', to.toISOString())
      .not('status', 'in', '("cancelled","no_show")')
      .order('appointment_time')
      .then(({ data }) => setRows(data ?? []))
  }, [date])

  if (!rows) return <div className="empty">Loading…</div>
  return (
    <PrintDoc title={"Day sheet — " + fmtD(date)}>
      {!rows.length ? <p style={{ textAlign: 'center', color: 'var(--soft)' }}>No appointments scheduled.</p> : (
        <table className="tbl" style={{ boxShadow: 'none' }}>
          <thead><tr><th>Time</th><th>Patient</th><th>Phone</th><th>Doctor</th><th>Treatment</th><th>Room</th></tr></thead>
          <tbody>{rows.map(a => (
            <tr key={a.id}>
              <td>{fmtT(a.appointment_time)}</td>
              <td>{a.patients?.full_name}</td>
              <td>{a.patients?.phone || '—'}</td>
              <td>{a.staff?.full_name || '—'}</td>
              <td>{a.treatments?.name || '—'}</td>
              <td>{a.floor_room || '—'}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
    </PrintDoc>
  )
}
