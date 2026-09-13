import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { fmtD, inr } from '../lib/format'
import PrintDoc from '../components/PrintDoc'

export default function PrintTreatmentPlan() {
  const { id } = useParams()
  const [plan, setPlan] = useState(null)
  const [stages, setStages] = useState(null)

  useEffect(() => {
    sb.from('treatment_plans').select('*, patients(full_name,phone,date_of_birth)').eq('id', id).single()
      .then(({ data }) => setPlan(data))
    sb.from('treatment_plan_stages').select('*').eq('plan_id', id).order('stage_number')
      .then(({ data }) => setStages(data ?? []))
  }, [id])

  if (!plan || !stages) return <div className="empty">Loading…</div>
  const stageTotal = stages.reduce((a, s) => a + Number(s.estimated_cost || 0), 0)

  return (
    <PrintDoc title="Treatment Plan & Estimate">
      <div className="print-row"><b>Patient</b><span>{plan.patients?.full_name}</span></div>
      <div className="print-row"><b>Phone</b><span>{plan.patients?.phone || '—'}</span></div>
      <div className="print-row"><b>Date</b><span>{fmtD(plan.created_at)}</span></div>
      {plan.plan_description && <div className="print-block"><h4>Plan</h4><p>{plan.plan_description}</p></div>}
      {stages.length > 0 && (
        <table className="tbl" style={{ boxShadow: 'none', marginTop: '1rem' }}>
          <thead><tr><th>#</th><th>Description</th><th>Estimated cost</th></tr></thead>
          <tbody>
            {stages.map(s => (
              <tr key={s.id}><td>{s.stage_number}</td><td>{s.description || '—'}</td><td>{inr(s.estimated_cost)}</td></tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="print-amount">{inr(plan.total_estimated_cost || stageTotal)}</div>
      {plan.patient_approved ? (
        <div className="print-signature">
          {plan.patient_signature_data
            ? <div><img src={plan.patient_signature_data} alt="Patient signature" />Patient signature — approved {fmtD(plan.approved_date)}</div>
            : <div>Approved by patient on {fmtD(plan.approved_date)}</div>}
        </div>
      ) : (
        <div className="print-signature">
          <div>Patient signature &amp; date</div>
          <div>Treating doctor</div>
        </div>
      )}
      <p style={{ fontSize: '.72rem', color: 'var(--soft)', marginTop: '1rem' }}>
        This is an estimate based on the treatment plan proposed at the time of examination — actual costs may
        vary depending on clinical findings during treatment.
      </p>
    </PrintDoc>
  )
}
