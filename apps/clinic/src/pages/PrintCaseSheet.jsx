import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { fmtD, inr } from '../lib/format'
import { ageLabel } from '../lib/age'
import { statusLabel } from '../lib/status'
import { toothLabel } from '../lib/teeth'
import { vitalsSummary, vitalsFlags } from '../lib/vitals'
import PrintDoc from '../components/PrintDoc'

// The sheet the clinic keeps in the paper file: who the patient is, what they
// are carrying medically, what was found today, and what is planned. One page,
// in the order a dentist reads it.
export default function PrintCaseSheet() {
  const { id } = useParams()
  const [d, setD] = useState(null)

  useEffect(() => {
    Promise.all([
      sb.from('patients').select('*').eq('id', id).single(),
      sb.from('medical_history').select('*').eq('patient_id', id).order('updated_at', { ascending: false }).limit(1),
      sb.from('patient_vitals').select('*, staff(full_name)').eq('patient_id', id).order('recorded_on', { ascending: false }).order('created_at', { ascending: false }).limit(1),
      sb.from('consultations').select('*, staff(full_name)').eq('patient_id', id).order('visit_date', { ascending: false }).limit(1),
      sb.from('tooth_chart').select('*').eq('patient_id', id).order('tooth_number'),
      sb.from('treatment_plans').select('*, treatment_plan_stages(*)').eq('patient_id', id).is('deleted_at', null).order('created_at', { ascending: false }),
    ]).then(([p, mh, vitals, visit, teeth, plans]) => setD({
      p: p.data, mh: mh.data?.[0] || null, vitals: vitals.data?.[0] || null,
      visit: visit.data?.[0] || null, teeth: teeth.data ?? [], plans: plans.data ?? [],
    }))
  }, [id])

  if (!d?.p) return <div className="empty">Loading…</div>
  const { p, mh, vitals, visit, teeth, plans } = d
  const age = ageLabel(p)
  const v = vitals ? vitalsSummary(vitals) : null
  const flags = vitals ? vitalsFlags(vitals) : []
  const charted = teeth.filter(t => t.condition)

  return (
    <PrintDoc title="Case sheet">
      {mh?.allergies && <p className="allergy-alert">⚠ Allergy: {mh.allergies}</p>}
      <div className="print-row"><b>Patient</b><span>{p.full_name} · {p.patient_code}{p.manual_id ? ' · file ' + p.manual_id : ''}</span></div>
      <div className="print-row"><b>Age / gender</b><span>{[age ? age + ' yrs' : null, p.gender].filter(Boolean).join(' · ') || '—'}</span></div>
      <div className="print-row"><b>Phone</b><span>{p.phone || '—'}</span></div>
      {p.address && <div className="print-row"><b>Address</b><span>{p.address}</span></div>}
      <div className="print-row"><b>Registered</b><span>{fmtD(p.created_at)}</span></div>

      <div className="print-block">
        <h4>Medical history</h4>
        {mh ? (
          <p>
            Conditions: {mh.condition || 'None recorded'}<br />
            Allergies: {mh.allergies || 'None recorded'}<br />
            Current medication: {mh.current_medications || 'None recorded'}<br />
            {mh.pregnancy_status ? <>Pregnant: yes<br /></> : null}
            {mh.notes ? <>Notes: {mh.notes}</> : null}
          </p>
        ) : <p>No medical history recorded.</p>}
      </div>

      <div className="print-block">
        <h4>Vitals {vitals && '· ' + fmtD(vitals.recorded_on)}</h4>
        {v ? (
          <p>
            BP {v.bp} · Pulse {v.pulse} · Temp {v.temperature} · SpO₂ {v.spo2}<br />
            Blood sugar {v.sugar} · Weight {v.weight}
            {flags.length ? <><br /><b>Check before treating: {flags.join(' · ')}</b></> : null}
            {vitals.notes ? <><br />{vitals.notes}</> : null}
          </p>
        ) : <p>No vitals recorded.</p>}
      </div>

      <div className="print-block">
        <h4>Last consultation {visit && '· ' + fmtD(visit.visit_date) + (visit.staff?.full_name ? ' · ' + visit.staff.full_name : '')}</h4>
        {visit ? (
          <p>
            Chief complaint: {visit.chief_complaint}<br />
            Examination: {visit.examination}<br />
            Diagnosis: {visit.diagnosis}<br />
            Treatment performed: {visit.treatment_performed}<br />
            Next visit: {visit.next_visit_plan}
          </p>
        ) : <p>No consultation recorded.</p>}
      </div>

      <div className="print-block">
        <h4>Charted findings</h4>
        {charted.length ? (
          <table className="tbl">
            <thead><tr><th>Tooth</th><th>Condition</th><th>Date</th><th>Notes</th></tr></thead>
            <tbody>{charted.map(t => (
              <tr key={t.id}><td>{toothLabel(t.tooth_number)}</td><td>{t.condition}</td><td>{fmtD(t.treatment_date)}</td><td>{t.notes || '—'}</td></tr>
            ))}</tbody>
          </table>
        ) : <p>Nothing charted.</p>}
      </div>

      <div className="print-block">
        <h4>Treatment plans</h4>
        {plans.length ? plans.map(pl => (
          <p key={pl.id}>
            <b>{pl.plan_description || 'Plan'}</b> · {statusLabel(pl.status)} · estimate {inr(pl.total_estimated_cost)}
            {pl.patient_approved ? ' · approved ' + fmtD(pl.approved_date) : ' · not yet approved'}
            {[...(pl.treatment_plan_stages || [])].sort((a, b) => a.stage_number - b.stage_number).map(s => (
              <span key={s.id}><br />&nbsp;&nbsp;{s.stage_number}. {s.description || 'Stage'} — {statusLabel(s.status)}{s.estimated_cost ? ' · ' + inr(s.estimated_cost) : ''}</span>
            ))}
          </p>
        )) : <p>No treatment plan recorded.</p>}
      </div>

      <div className="print-signature">
        <div>Doctor</div>
        <div>Patient / guardian</div>
      </div>
    </PrintDoc>
  )
}
