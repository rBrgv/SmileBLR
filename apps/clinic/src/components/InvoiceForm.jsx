import { useEffect, useRef, useState } from 'react'
import { sb } from '../lib/supabase'
import { fetchAll, received } from '../lib/handoff'
import { emptyInvoiceLine, invoiceTotals, lineTotals } from '../lib/clinical'
import { inr } from '../lib/format'
import { invoiceLinesFrom } from '../lib/records'
import Modal from './Modal'
import ToothSelect from './ToothSelect'
import { useToast } from './Toast'
export default function InvoiceForm({patientId,doctors,invoice,fromPlan,fromRecords,onClose,onDone}) {
  // An issued invoice is editable: 026 removed the freeze, the database
  // re-totals from the lines, and the previous version is kept automatically.
  const editing=Boolean(invoice)
  const [items,setItems]=useState(invoice?.items?.length?invoice.items.map(i=>({...emptyInvoiceLine(),...i})):fromPlan?.items?.length?fromPlan.items.map(i=>({...emptyInvoiceLine(),...i})):fromRecords?.length?invoiceLinesFrom(fromRecords).map(i=>({...emptyInvoiceLine(),...i})):[emptyInvoiceLine()]),[plans,setPlans]=useState([]),[records,setRecords]=useState([]),[plan,setPlan]=useState(invoice?.source_plan_id||fromPlan?.id||''),[doctor,setDoctor]=useState(invoice?.doctor_id||''),[notes,setNotes]=useState(invoice?.notes||''),[busy,setBusy]=useState(false)
  const lock=useRef(false),toast=useToast(),totals=invoiceTotals(items)
  useEffect(()=>{
    Promise.all([
      fetchAll(()=>sb.from('treatment_plans').select('*, treatment_plan_stages(*)').eq('patient_id',patientId).eq('patient_approved',true).is('deleted_at',null).order('id')),
      fetchAll(()=>sb.from('treatment_records').select('*, treatments(name,price_min)').eq('patient_id',patientId).is('deleted_at',null).order('id'))
    ]).then(([p,r])=>{setPlans(p);setRecords(r)}).catch(e=>toast(e.message))
  },[patientId])
  function usePlan(id){setPlan(id);if(!id)return;const p=plans.find(p=>p.id===id);if(!p){if(fromPlan?.id===id&&fromPlan.items?.length)setItems(fromPlan.items.map(i=>({...emptyInvoiceLine(),...i})));return}const stages=[...(p.treatment_plan_stages||[])].sort((a,b)=>a.stage_number-b.stage_number);setItems(stages.length?stages.map(s=>({...emptyInvoiceLine(),description:s.description||`Stage ${s.stage_number}`,unit_price:s.estimated_cost||0})):[{...emptyInvoiceLine(),description:p.plan_description||'Treatment plan',unit_price:p.total_estimated_cost||0}])}
  function addRecord(id){const r=records.find(r=>r.id===id);if(!r)return;const line={...emptyInvoiceLine(),description:r.treatments?.name||r.notes||'Treatment',tooth_number:r.tooth_number||'',unit_price:Number(r.amount??r.treatments?.price_min??0),treatment_record_id:r.id};setItems(rows=>rows.length===1&&!rows[0].description?[line]:[...rows,line]);setPlan('')}
  // A plan opened straight from the plan screen may not be approved yet, so it
  // is listed alongside the approved estimates rather than silently missing.
  const planOptions=fromPlan&&!plans.some(p=>p.id===fromPlan.id)?[{...fromPlan,unapproved:!fromPlan.patient_approved},...plans]:plans
  const update=(i,k,v)=>setItems(rows=>rows.map((r,j)=>i===j?{...r,[k]:v}:r))
  async function save(e){e.preventDefault();if(lock.current)return;lock.current=true;setBusy(true)
    try{
      const row={items,amount:totals.net,tax_amount:totals.tax,source_plan_id:plan||null,doctor_id:doctor||null,notes:notes.trim()||null}
      const {error}=editing
        ? await sb.from('invoices').update(row).eq('id',invoice.id)
        : await sb.from('invoices').insert({patient_id:patientId,...row})
      if(error)throw error;toast(editing?'Invoice updated':'Invoice created');onDone()
    }catch(e){toast(e.message)}finally{lock.current=false;setBusy(false)}
  }
  return <Modal title={editing?'Edit invoice':'New itemised invoice'} onClose={()=>!busy&&onClose()}><form onSubmit={save}>
    {editing&&received(invoice)>0&&<p>{inr(received(invoice))} has already been received against this invoice. Correcting the charges here does not change what was paid — settle any difference in the payment editor.</p>}
    <label>Start from an approved estimate<select value={plan} onChange={e=>usePlan(e.target.value)}><option value="">Enter procedures manually</option>{planOptions.map(p=><option key={p.id} value={p.id}>{p.plan_description||p.id}{p.unapproved?' · not yet approved':''}</option>)}</select></label>
    <label>Add recorded treatment<select value="" onChange={e=>addRecord(e.target.value)}><option value="">Choose treatment</option>{records.map(r=><option key={r.id} value={r.id}>{r.performed_date} · {r.treatments?.name||'Treatment'} · Tooth {r.tooth_number||'—'}</option>)}</select></label>
    <p>Review charges before issuing. Adding a treatment here does not determine whether it was previously billed.</p>
    {items.map((r,i)=><fieldset key={i} style={{marginBottom:'1rem'}}><legend>Procedure {i+1}</legend>
      <label>Procedure<input required value={r.description} onChange={e=>update(i,'description',e.target.value)}/></label>
      <label>Tooth<ToothSelect value={r.tooth_number} onChange={e=>update(i,'tooth_number',e.target.value)}/></label>
      {[['quantity','Quantity',0.01,10000],['unit_price','Unit price (INR)',0,100000000],['discount','Line discount (INR)',0,undefined],['tax_rate','Tax (%)',0,100]].map(([k,label,min,max])=><label key={k}>{label}<input type="number" required step="0.01" min={min} max={max} value={r[k]} onChange={e=>update(i,k,e.target.value)}/></label>)}
      <p>Line total: {inr(lineTotals(r).total)}</p>
      {items.length>1&&<button type="button" className="btn ghost sm" onClick={()=>setItems(rows=>rows.filter((_,j)=>j!==i))}>Remove line</button>}
    </fieldset>)}
    <button className="btn ghost" type="button" disabled={items.length>=100||busy} onClick={()=>setItems(r=>[...r,emptyInvoiceLine()])}>+ Add procedure</button>
    <label>Treating doctor<select value={doctor} onChange={e=>setDoctor(e.target.value)}><option value="">—</option>{doctors.map(d=><option key={d.id} value={d.id}>{d.full_name}</option>)}</select></label>
    <label>Notes<textarea value={notes} onChange={e=>setNotes(e.target.value)}/></label>
    <p>After discounts: {inr(totals.net)} · Tax: {inr(totals.tax)} · Total: <b>{inr(totals.total)}</b></p>
    <button className="btn" disabled={busy} type="submit">{busy?'Saving…':editing?'Save changes':'Issue invoice'}</button>
  </form></Modal>
}
