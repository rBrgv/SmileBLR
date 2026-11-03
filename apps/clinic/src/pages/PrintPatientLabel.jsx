import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { fmtD } from '../lib/format'
import { ageLabel } from '../lib/age'
import PrintDoc from '../components/PrintDoc'

// Sticks on the paper file, so it carries exactly what someone needs to find
// that file again: both numbers, the name, and enough to tell two patients of
// the same name apart.
export default function PrintPatientLabel() {
  const { id } = useParams()
  const [p, setP] = useState(null)

  useEffect(() => {
    sb.from('patients').select('full_name, phone, gender, patient_code, manual_id, date_of_birth, approx_age, approx_age_recorded_on, created_at')
      .eq('id', id).single().then(({ data }) => setP(data))
  }, [id])

  if (!p) return <div className="empty">Loading…</div>

  return (
    <PrintDoc title="Patient file label">
      <div className="print-amount">{p.patient_code}</div>
      <div className="print-row"><b>Name</b><span>{p.full_name}</span></div>
      {p.manual_id && <div className="print-row"><b>Clinic file no.</b><span>{p.manual_id}</span></div>}
      {ageLabel(p) && <div className="print-row"><b>Age</b><span>{ageLabel(p)}{p.gender ? ' · ' + p.gender : ''}</span></div>}
      {!ageLabel(p) && p.gender && <div className="print-row"><b>Gender</b><span>{p.gender}</span></div>}
      {p.phone && p.phone !== 'N/A' && <div className="print-row"><b>Phone</b><span>{p.phone}</span></div>}
      <div className="print-row"><b>Registered</b><span>{fmtD(p.created_at)}</span></div>
    </PrintDoc>
  )
}
