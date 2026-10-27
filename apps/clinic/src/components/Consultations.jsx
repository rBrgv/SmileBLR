import { useEffect, useRef, useState } from 'react'
import { sb } from '../lib/supabase'
import { today, fmtD, fmtDT } from '../lib/format'
import { fetchAll } from '../lib/handoff'
import Modal from './Modal'
import ClinicalButton from './ClinicalButton'
import { useToast } from './Toast'
const FIELDS = [['chief_complaint','Chief complaint'],['examination','Examination findings'],['diagnosis','Diagnosis / working diagnosis'],['treatment_performed','Treatment performed'],['next_visit_plan','Next-visit plan']]
export default function Consultations({ patientId }) {
  const [rows,setRows]=useState([]), [show,setShow]=useState(false), [amend,setAmend]=useState(null)
  const toast=useToast()
  async function load() {
    try { setRows(await fetchAll(() => sb.from('consultations').select('*, staff(full_name), consultation_amendments(*, staff(full_name))').eq('patient_id',patientId).order('visit_date',{ascending:false}).order('id'))) }
    catch(e){ toast(e.message) }
  }
  useEffect(()=>{load()},[patientId])
  return <>
    <ClinicalButton className="btn" onClick={()=>setShow(true)}>+ Consultation</ClinicalButton>
    {rows.map(r=><div className="overview-card" key={r.id}>
      <b>{fmtD(r.visit_date)} · {r.staff?.full_name}</b>
      {FIELDS.map(([key,label])=><p key={key}><b>{label}:</b> <span style={{whiteSpace:'pre-wrap'}}>{r[key]}</span></p>)}
      <p>History reviewed {fmtDT(r.reviewed_at)} · Recorded {fmtDT(r.created_at)}</p>
      <details><summary>Medical history at review</summary>{r.history_snapshot ? <p style={{whiteSpace:'pre-wrap'}}>{['condition','allergies','current_medications','notes'].map(k=>`${k.replaceAll('_',' ')}: ${r.history_snapshot[k] || 'Not recorded'}`).join('\n')}</p> : <p>No medical history was on file.</p>}</details>
      {(r.consultation_amendments || []).sort((a,b)=>a.created_at.localeCompare(b.created_at)).map(a=><p key={a.id} style={{whiteSpace:'pre-wrap'}}><b>Addendum {fmtDT(a.created_at)} · {a.staff?.full_name}</b><br/>Reason: {a.reason}<br/>{a.note}</p>)}
      <ClinicalButton className="btn ghost sm" onClick={()=>setAmend(r)}>Add dated amendment</ClinicalButton>
    </div>)}
    {show && <VisitForm patientId={patientId} onClose={()=>setShow(false)} onDone={()=>{setShow(false);load()}}/>}
    {amend && <VisitForm patientId={patientId} consultation={amend} onClose={()=>setAmend(null)} onDone={()=>{setAmend(null);load()}}/>}
  </>
}
function VisitForm({patientId,consultation,onClose,onDone}) {
  const [f,setF]=useState({visit_date:today(),appointment_id:'',chief_complaint:'',examination:'',diagnosis:'',treatment_performed:'',next_visit_plan:'',history_reviewed:false,reason:'',note:''})
  const [appointments,setAppointments]=useState([]),[busy,setBusy]=useState(false)
  const lock=useRef(false),toast=useToast()
  useEffect(()=>{ if(!consultation) fetchAll(()=>sb.from('appointments').select('id,appointment_time').eq('patient_id',patientId).order('appointment_time',{ascending:false}).order('id')).then(setAppointments).catch(e=>toast(e.message)) },[patientId])
  const set=k=>e=>setF(x=>({...x,[k]:e.target.value}))
  async function save(e){
    e.preventDefault();if(lock.current)return;lock.current=true;setBusy(true)
    try {
      const rec=consultation ? {consultation_id:consultation.id,reason:f.reason.trim(),note:f.note.trim()} : {patient_id:patientId,visit_date:f.visit_date,appointment_id:f.appointment_id||null,history_reviewed:f.history_reviewed,...Object.fromEntries(FIELDS.map(([k])=>[k,f[k].trim()]))}
      const {error}=await sb.from(consultation?'consultation_amendments':'consultations').insert(rec)
      if(error)throw error;toast(consultation?'Amendment recorded':'Consultation recorded');onDone()
    }catch(e){toast(e.message)}finally{lock.current=false;setBusy(false)}
  }
  return <Modal title={consultation?'Dated amendment':'New consultation'} onClose={()=>!busy&&onClose()}><form onSubmit={save}>
    {consultation ? <><label>Reason for amendment<input required value={f.reason} onChange={set('reason')}/></label><label>Addendum<textarea required value={f.note} onChange={set('note')}/></label></> : <>
      <label>Visit date<input type="date" required max={today()} value={f.visit_date} onChange={set('visit_date')}/></label>
      <label>Appointment<select value={f.appointment_id} onChange={set('appointment_id')}><option value="">Unscheduled consultation</option>{appointments.map(a=><option key={a.id} value={a.id}>{fmtDT(a.appointment_time)}</option>)}</select></label>
      {FIELDS.map(([k,label])=><label key={k}>{label}<textarea required value={f[k]} onChange={set(k)}/></label>)}
      <label style={{textTransform:'none'}}><input type="checkbox" required style={{width:'auto'}} checked={f.history_reviewed} onChange={e=>setF(x=>({...x,history_reviewed:e.target.checked}))}/> I reviewed the patient's medical history and medications today</label>
    </>}
    <p>Saved notes remain unchanged. Record corrections as dated amendments.</p>
    <ClinicalButton className="btn" type="submit" disabled={busy}>{busy?'Saving…':'Save consultation'}</ClinicalButton>
  </form></Modal>
}
