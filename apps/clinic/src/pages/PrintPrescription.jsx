import { medicinesFor } from '../lib/clinical'
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { ageLabel } from '../lib/age'
import { fmtD } from '../lib/format'
import PrintDoc from '../components/PrintDoc'

export default function PrintPrescription() {
  const { id } = useParams()
  const [rx, setRx] = useState(null)

  useEffect(() => {
    sb.from('prescriptions').select('*, patients(full_name,phone,date_of_birth,approx_age,approx_age_recorded_on,gender), staff(full_name,qualifications)').eq('id', id).single()
      .then(({ data }) => setRx(data))
  }, [id])

  if (!rx) return <div className="empty">Loading…</div>
  return (
    <PrintDoc title="Prescription">
      <div className="print-row"><b>Date</b><span>{fmtD(rx.prescribed_date)}</span></div>
      <div className="print-row"><b>Patient</b><span>{rx.patients?.full_name}</span></div>
      <div className="print-row"><b>Phone</b><span>{rx.patients?.phone || '—'}</span></div>
      {ageLabel(rx.patients) && <div className="print-row"><b>Age</b><span>{ageLabel(rx.patients)}</span></div>}
      <div className="print-block">
        <h4>℞</h4>
        <table className="tbl"><thead><tr><th>Medicine / strength</th><th>Dose</th><th>Frequency</th><th>Duration</th><th>Instructions</th></tr></thead><tbody>{medicinesFor(rx).map((m,i)=><tr key={i}><td>{m.name} {m.strength}</td><td>{m.dose}</td><td>{m.frequency || '—'}</td><td>{m.duration}</td><td>{m.instructions || '—'}</td></tr>)}</tbody></table>
        {rx.notes && <p>{rx.notes}</p>}
      </div>
      <div className="print-signature">
        <div>{rx.staff?.full_name || 'Prescribing doctor'}{rx.staff?.qualifications ? ' — ' + rx.staff.qualifications : ''}</div>
      </div>
    </PrintDoc>
  )
}
