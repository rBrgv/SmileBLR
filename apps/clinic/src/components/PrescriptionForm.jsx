import { useRef, useState } from 'react'
import { sb } from '../lib/supabase'
import { emptyMedicine } from '../lib/clinical'
import Modal from './Modal'
import ConfirmDialog from './ConfirmDialog'
import ClinicalButton from './ClinicalButton'
import { useToast } from './Toast'
export default function PrescriptionForm({patientId,doctors,allergies,onClose,onDone}) {
  const [medicines,setMedicines]=useState([emptyMedicine()]),[doctor,setDoctor]=useState(''),[notes,setNotes]=useState(''),[busy,setBusy]=useState(false),[confirm,setConfirm]=useState(false)
  const lock=useRef(false),toast=useToast()
  const update=(i,k,v)=>setMedicines(rows=>rows.map((r,j)=>i===j?{...r,[k]:v}:r))
  async function save(){
    if(lock.current)return;lock.current=true;setBusy(true)
    try{
      const {error}=await sb.from('prescriptions').insert({patient_id:patientId,prescribed_by:doctor,medicines,medicine_name:medicines[0].name,notes:notes.trim()||null})
      if(error)throw error;toast('Prescription saved');onDone()
    }catch(e){toast(e.message)}finally{lock.current=false;setBusy(false)}
  }
  function submit(e){e.preventDefault(); if(allergies) setConfirm(true);else save()}
  return <><Modal title="New prescription" onClose={()=>!busy&&onClose()}><form onSubmit={submit}>
    {allergies&&<div className="allergy-alert">Recorded allergies: {allergies}. Review every medicine before prescribing.</div>}
    {medicines.map((m,i)=><fieldset key={i} style={{marginBottom:'1rem'}}><legend>Medicine {i+1}</legend>
      {[['name','Medicine',true],['strength','Strength',false],['dose','Dose',true],['frequency','Frequency',true],['duration','Duration',true],['instructions','Instructions',false]].map(([k,label,required])=><label key={k}>{label}<input required={required} value={m[k]} onChange={e=>update(i,k,e.target.value)}/></label>)}
      {medicines.length>1&&<button type="button" className="btn ghost sm" onClick={()=>setMedicines(rows=>rows.filter((_,j)=>j!==i))}>Remove medicine</button>}
    </fieldset>)}
    <button type="button" className="btn ghost" disabled={medicines.length>=30||busy} onClick={()=>setMedicines(r=>[...r,emptyMedicine()])}>+ Add medicine</button>
    <label>Prescribing doctor<select required value={doctor} onChange={e=>setDoctor(e.target.value)}><option value="">Choose doctor</option>{doctors.map(d=><option key={d.id} value={d.id}>{d.full_name}</option>)}</select></label>
    <label>Prescription notes<textarea value={notes} onChange={e=>setNotes(e.target.value)}/></label>
    <ClinicalButton className="btn" disabled={busy} type="submit">{busy?'Saving…':'Save prescription'}</ClinicalButton>
  </form></Modal>
  {confirm&&<ConfirmDialog title="Review recorded allergies" body={`Recorded allergies: ${allergies}. Confirm you have reviewed all medicines in this prescription.`} confirmLabel="Reviewed — save prescription" onCancel={()=>setConfirm(false)} onConfirm={()=>{setConfirm(false);save()}}/>}
  </>
}
