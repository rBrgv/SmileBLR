import ClinicalButton from '../components/ClinicalButton'
import { fetchAll } from '../lib/handoff'
import { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { fmtD } from '../lib/format'
import { useToast } from '../components/Toast'
import Modal from '../components/Modal'
import ConfirmDialog from '../components/ConfirmDialog'
import SignaturePad from '../components/SignaturePad'
import { logActivity } from '../lib/activityLog'

const SIGN_FILTERS = [['', 'All'], ['signed', 'Signed'], ['unsigned', 'Unsigned']]

export default function ConsentForms() {
  const [rows, setRows] = useState(null)
  const [q, setQ] = useState('')
  const [sf, setSf] = useState('')
  const [show, setShow] = useState(false)
  const [sign, setSign] = useState(null) // form being signed
  const [confirmDel, setConfirmDel] = useState(null)
  const toast = useToast()
  const nav = useNavigate()

  async function load() {
    const { data, error } = await sb.from('consent_forms').select('*, patients(id,full_name,date_of_birth)')
      .is('deleted_at', null).order('created_at', { ascending: false }).limit(300)
    if (error) { toast('Error: ' + error.message); return setRows([]) }
    setRows(data)
  }
  useEffect(() => { load() }, [])

  async function remove(id) {
    const { error } = await sb.from('consent_forms').update({ deleted_at: new Date().toISOString() }).eq('id', id)
    if (error) return toast('Error: ' + error.message)
    toast('Moved to trash', { actionLabel: 'Undo', onAction: async () => { await sb.from('consent_forms').update({ deleted_at: null }).eq('id', id); load() } })
    load()
  }

  if (!rows) return <div className="empty">Loading…</div>
  const view = rows.filter(c =>
    (!q || (c.patients?.full_name || '').toLowerCase().includes(q.toLowerCase())) &&
    (!sf || (sf === 'signed') === !!c.consent_given))

  return (
    <>
      <div className="pagehead">
        <h2>Consent forms</h2>
        <ClinicalButton className="btn" onClick={() => setShow(true)}>+ New form</ClinicalButton>
      </div>
      <div className="bar">
        <input placeholder="Search patient…" value={q} onChange={e => setQ(e.target.value)} />
        <select value={sf} onChange={e => setSf(e.target.value)}>
          {SIGN_FILTERS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
        </select>
      </div>
      {!view.length ? <div className="empty">No consent forms yet.</div> : (
        <table className="tbl">
          <thead><tr><th>Patient</th><th>Procedure</th><th>Signed</th><th>Date</th><th></th></tr></thead>
          <tbody>{view.map(c => (
            <tr key={c.id}>
              <td className="link" onClick={() => nav('/patients/' + c.patients?.id)}>{c.patients?.full_name}</td>
              <td>{c.procedure}</td>
              <td><span className={`badge ${c.consent_given ? 'b-completed' : 'b-pending'}`}>{c.consent_given ? 'signed' : 'unsigned'}</span></td>
              <td>{c.signed_date ? fmtD(c.signed_date) : '—'}{c.consent_given && !c.signature_data && !c.document_url && <div>Legacy record: evidence not recorded</div>}</td>
              <td>
                {!c.consent_given && <ClinicalButton className="btn sm ghost" onClick={() => setSign(c)}>Mark signed</ClinicalButton>}{' '}
                {c.document_url?.startsWith('https://') && <a className="btn sm ghost" target="_blank" rel="noreferrer" href={c.document_url}>Document</a>}{' '}
                <a className="btn sm ghost" target="_blank" rel="noreferrer" href={'/print/consent/' + c.id}>Print</a>{' '}
                <ClinicalButton className="btn sm ghost danger" onClick={() => setConfirmDel(c.id)}>Delete</ClinicalButton>
              </td>
            </tr>
          ))}</tbody>
        </table>
      )}
      {show && <ConsentFormForm onClose={() => setShow(false)} onDone={() => { setShow(false); load() }} />}
      {sign && <SignForm form={sign} onClose={() => setSign(null)} onDone={() => { setSign(null); load() }} />}
      {confirmDel && <ConfirmDialog title="Move this consent form to trash?" confirmLabel="Move to trash" onCancel={() => setConfirmDel(null)}
        onConfirm={() => { remove(confirmDel); setConfirmDel(null) }} />}
    </>
  )
}

function ConsentFormForm({onClose,onDone}) {
  const [patients,setPatients]=useState([]),[templates,setTemplates]=useState([]),[newTemplate,setNewTemplate]=useState(false),[busy,setBusy]=useState(false)
  const [f,setF]=useState({patient_id:'',procedure:'',statement:'',template_id:''})
  const lock=useRef(false),toast=useToast()
  const set=k=>e=>setF(x=>({...x,[k]:e.target.value}))
  function loadTemplates(){fetchAll(()=>sb.from('consent_templates').select('*').order('created_at',{ascending:false}).order('id')).then(setTemplates).catch(e=>toast(e.message))}
  useEffect(()=>{fetchAll(()=>sb.from('patients').select('id,full_name').is('merged_into',null).order('full_name').order('id')).then(setPatients).catch(e=>toast(e.message));loadTemplates()},[])
  async function save(e){e.preventDefault();if(lock.current)return;lock.current=true;setBusy(true)
    try{const {error}=await sb.from('consent_forms').insert({...f,template_id:f.template_id||null});if(error)throw error;toast('Consent form created');onDone()}
    catch(e){toast(e.message)}finally{lock.current=false;setBusy(false)}
  }
  return <><Modal title="New consent form" onClose={()=>!busy&&onClose()}><form onSubmit={save}>
    <label>Patient<select required value={f.patient_id} onChange={set('patient_id')}><option value="">Choose patient</option>{patients.map(p=><option key={p.id} value={p.id}>{p.full_name}</option>)}</select></label>
    <label>Clinic-approved template<select value={f.template_id} onChange={e=>{const t=templates.find(t=>t.id===e.target.value);setF(x=>({...x,template_id:t?.id||'',procedure:t?.procedure||'',statement:t?.statement||''}))}}><option value="">Write procedure-specific consent</option>{templates.map(t=><option key={t.id} value={t.id}>{t.procedure} · {fmtD(t.created_at)}</option>)}</select></label>
    <ClinicalButton type="button" className="btn ghost sm" onClick={()=>setNewTemplate(true)}>+ Clinic-approved template</ClinicalButton>
    <label>Procedure<input required readOnly={!!f.template_id} value={f.procedure} onChange={set('procedure')}/></label>
    <label>Consent text<textarea required rows={8} readOnly={!!f.template_id} value={f.statement} onChange={set('statement')} placeholder="Enter the clinic's procedure-specific explanation, risks, benefits and alternatives."/></label>
    <label style={{textTransform:'none'}}><input style={{width:'auto'}} type="checkbox" required/> I have reviewed this text for the procedure</label>
    <ClinicalButton type="submit" className="btn" disabled={busy}>Save form</ClinicalButton>
  </form></Modal>{newTemplate&&<TemplateForm onClose={()=>setNewTemplate(false)} onDone={()=>{setNewTemplate(false);loadTemplates()}}/>}</>
}
function TemplateForm({onClose,onDone}) {
  const [procedure,setProcedure]=useState(''),[statement,setStatement]=useState(''),[busy,setBusy]=useState(false)
  const lock=useRef(false),toast=useToast()
  async function save(e){e.preventDefault();if(lock.current)return;lock.current=true;setBusy(true)
    try{const {error}=await sb.from('consent_templates').insert({procedure:procedure.trim(),statement:statement.trim()});if(error)throw error;toast('Approved template saved');onDone()}
    catch(e){toast(e.message)}finally{lock.current=false;setBusy(false)}
  }
  return <Modal title="New clinic-approved consent template" onClose={()=>!busy&&onClose()}><form onSubmit={save}>
    <label>Procedure<input required value={procedure} onChange={e=>setProcedure(e.target.value)}/></label>
    <label>Approved consent wording<textarea required rows={10} value={statement} onChange={e=>setStatement(e.target.value)}/></label>
    <label style={{textTransform:'none'}}><input type="checkbox" required style={{width:'auto'}}/> I approve this wording for use by the clinic</label>
    <p>Each saved template is a fixed version. Create a new version when the wording changes.</p>
    <ClinicalButton type="submit" className="btn" disabled={busy}>Approve template</ClinicalButton>
  </form></Modal>
}
function SignForm({form,onClose,onDone}) {
  const [documentUrl,setDocumentUrl]=useState(form.document_url||''),[signature,setSignature]=useState(null),[statement,setStatement]=useState(form.statement||'')
  const [kind,setKind]=useState('patient'),[name,setName]=useState(form.patients?.full_name||''),[relationship,setRelationship]=useState(''),[busy,setBusy]=useState(false)
  const lock=useRef(false),toast=useToast()
  async function save(e){e.preventDefault();if(lock.current)return
    if(!signature&&!/^https:\/\/\S+$/.test(documentUrl.trim()))return toast('Capture a signature or link the signed document.')
    lock.current=true;setBusy(true)
    try{
      const {data,error}=await sb.from('consent_forms').update({consent_given:true,statement:statement.trim(),document_url:documentUrl.trim()||null,signature_data:signature,signer_kind:kind,signer_name:name.trim(),guardian_relationship:kind==='guardian'?relationship.trim():null}).eq('id',form.id).eq('consent_given',false).select('id')
      if(error)throw error;if(!data?.length)throw new Error('Form already signed or changed. Reload before continuing.')
      logActivity('consent.signed','consent_form',form.id,`Consent evidence recorded for ${form.procedure}`);toast('Consent recorded');onDone()
    }catch(e){toast(e.message)}finally{lock.current=false;setBusy(false)}
  }
  return <Modal title={'Record signed consent — '+form.procedure} onClose={()=>!busy&&onClose()}><form onSubmit={save}>
    <label>Consent statement<textarea required readOnly={!!form.statement} rows={6} value={statement} onChange={e=>setStatement(e.target.value)}/></label>
    {!form.statement&&<p>Legacy draft: enter the exact procedure-specific wording explained to the signer.</p>}
    <label>Signed by<select value={kind} onChange={e=>{setKind(e.target.value);setName(e.target.value==='patient'?form.patients?.full_name||'':'')}}><option value="patient">Patient</option><option value="guardian">Guardian</option></select></label>
    <label>Signer full name<input required value={name} onChange={e=>setName(e.target.value)}/></label>
    {kind==='guardian'&&<label>Relationship to patient<input required value={relationship} onChange={e=>setRelationship(e.target.value)}/></label>}
    <p>For a minor, choose the guardian and record their name and relationship.</p>
    <label>Signature</label>{signature?<><img src={signature} alt="Captured signature" style={{maxWidth:'100%'}}/><button type="button" className="btn ghost sm" onClick={()=>setSignature(null)}>Redo signature</button></>:<SignaturePad onSave={setSignature}/>}
    <label>Or HTTPS link to signed document<input type="url" pattern="https://.*" value={documentUrl} onChange={e=>setDocumentUrl(e.target.value)}/></label>
    <label style={{textTransform:'none'}}><input type="checkbox" required style={{width:'auto'}}/> I verified the signer and the recorded consent evidence</label>
    <ClinicalButton className="btn" type="submit" disabled={busy}>{busy?'Saving…':'Record signed consent'}</ClinicalButton>
  </form></Modal>
}
