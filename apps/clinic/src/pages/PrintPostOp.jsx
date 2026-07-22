import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { fmtD } from '../lib/format'
import { getPostOpInstructions } from '../lib/postOpInstructions'
import PrintDoc from '../components/PrintDoc'

export default function PrintPostOp() {
  const { id } = useParams()
  const [rec, setRec] = useState(null)

  useEffect(() => {
    sb.from('treatment_records').select('*, patients(full_name,phone), treatments(name), staff(full_name,qualifications)').eq('id', id).single()
      .then(({ data }) => setRec(data))
  }, [id])

  if (!rec) return <div className="empty">Loading…</div>
  const tpl = getPostOpInstructions(rec.treatments?.name)

  return (
    <PrintDoc title={tpl.title}>
      <div className="print-row"><b>Date</b><span>{fmtD(rec.performed_date)}</span></div>
      <div className="print-row"><b>Patient</b><span>{rec.patients?.full_name}</span></div>
      {rec.treatments?.name && <div className="print-row"><b>Procedure</b><span>{rec.treatments.name}{rec.tooth_number ? ' · Tooth ' + rec.tooth_number : ''}</span></div>}
      <div className="print-block">
        <ul style={{ paddingLeft: '1.2rem', lineHeight: 1.8 }}>
          {tpl.points.map((p, i) => <li key={i}>{p}</li>)}
        </ul>
      </div>
      <p style={{ fontSize: '.78rem', color: 'var(--mid)', marginTop: '1rem' }}>
        Call the clinic if anything feels unusual — we'd rather hear from you than have you wait it out.
      </p>
      <div className="print-signature">
        <div>{rec.staff?.full_name || 'Treating doctor'}{rec.staff?.qualifications ? ' — ' + rec.staff.qualifications : ''}</div>
      </div>
    </PrintDoc>
  )
}
