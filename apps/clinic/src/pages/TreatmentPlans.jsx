import { useEffect, useState } from 'react'
import { sb } from '../lib/supabase'
import { fmtD, inr } from '../lib/format'
import { useToast } from '../components/Toast'
import Modal from '../components/Modal'
import StatusSelect from '../components/StatusSelect'
import ConfirmDialog from '../components/ConfirmDialog'
import { useRole } from '../lib/RoleContext'
import { RecordForm } from '../components/TreatmentRecordPanel'
import SignaturePad from '../components/SignaturePad'
import { logActivity } from '../lib/activityLog'

export const PLAN_STATUSES = ['proposed', 'accepted', 'in_progress', 'completed', 'cancelled']
const STAGE_STATUSES = ['pending', 'scheduled', 'completed']

export default function TreatmentPlans() {
  const [rows, setRows] = useState(null)
  const [q, setQ] = useState('')
  const [st, setSt] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [detail, setDetail] = useState(null) // plan id
  const [confirmDel, setConfirmDel] = useState(null)
  const [showTemplates, setShowTemplates] = useState(false)
  const toast = useToast()

  async function load() {
    const { data, error } = await sb.from('treatment_plans')
      .select('*, patients(full_name), treatment_plan_stages(id,status)')
      .is('deleted_at', null).order('created_at', { ascending: false })
    if (error) { toast('Error: ' + error.message); return setRows([]) }
    setRows(data)
  }
  useEffect(() => { load() }, [])

  async function setStatus(id, status) {
    const { error } = await sb.from('treatment_plans').update({ status }).eq('id', id)
    if (error) return toast('Error: ' + error.message)
    toast('Plan ' + status.replace('_', ' ')); load()
  }

  async function removePlan(id) {
    const { error } = await sb.from('treatment_plans').update({ deleted_at: new Date().toISOString() }).eq('id', id)
    if (error) return toast('Error: ' + error.message)
    toast('Moved to trash', { actionLabel: 'Undo', onAction: async () => { await sb.from('treatment_plans').update({ deleted_at: null }).eq('id', id); load() } })
    load()
  }

  if (!rows) return <div className="empty">Loading…</div>
  const view = rows.filter(p =>
    (!q || (p.patients?.full_name || '').toLowerCase().includes(q.toLowerCase())) && (!st || p.status === st))

  return (
    <>
      <div className="pagehead">
        <h2>Treatment plans</h2>
        <div>
          <button className="btn ghost" onClick={() => setShowTemplates(true)}>Manage templates</button>{' '}
          <button className="btn" onClick={() => setShowForm(true)}>+ New plan</button>
        </div>
      </div>
      <div className="bar">
        <input placeholder="Search patient…" value={q} onChange={e => setQ(e.target.value)} />
        <select value={st} onChange={e => setSt(e.target.value)}>
          <option value="">All statuses</option>
          {PLAN_STATUSES.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
        </select>
      </div>
      {!view.length ? <div className="empty">No treatment plans yet.</div> : (
        <table className="tbl">
          <thead><tr><th>Patient</th><th>Description</th><th>Est. cost</th><th>Stages</th><th>Status</th><th></th></tr></thead>
          <tbody>{view.map(p => {
            const stages = p.treatment_plan_stages || []
            const done = stages.filter(s => s.status === 'completed').length
            return (
              <tr key={p.id}>
                <td className="link" onClick={() => setDetail(p.id)}>{p.patients?.full_name}</td>
                <td>{p.plan_description || '—'}</td>
                <td>{inr(p.total_estimated_cost)}</td>
                <td>{done}/{stages.length}</td>
                <td><StatusSelect value={p.status} options={PLAN_STATUSES} onChange={s => setStatus(p.id, s)} /></td>
                <td>
                  <button className="btn sm ghost" onClick={() => setDetail(p.id)}>Open</button>{' '}
                  <a className="btn sm ghost" target="_blank" rel="noreferrer" href={'/print/plan/' + p.id}>Print</a>{' '}
                  <button className="btn sm ghost danger" onClick={() => setConfirmDel(p.id)}>Delete</button>
                </td>
              </tr>
            )
          })}</tbody>
        </table>
      )}
      {showForm && <PlanForm onClose={() => setShowForm(false)} onDone={() => { setShowForm(false); load() }} />}
      {detail && <PlanDetail id={detail} onClose={() => setDetail(null)} onChanged={load} />}
      {confirmDel && <ConfirmDialog title="Move this treatment plan to trash?" body="You can restore it later from Trash." confirmLabel="Move to trash"
        onCancel={() => setConfirmDel(null)} onConfirm={() => { removePlan(confirmDel); setConfirmDel(null) }} />}
      {showTemplates && <TemplatesManager onClose={() => setShowTemplates(false)} />}
    </>
  )
}

function PlanForm({ onClose, onDone }) {
  const [patients, setPatients] = useState([])
  const [templates, setTemplates] = useState([])
  const [f, setF] = useState({ patient_id: '', plan_description: '', total_estimated_cost: '', template_id: '' })
  const toast = useToast()
  const set = k => e => setF(x => ({ ...x, [k]: e.target.value }))

  useEffect(() => {
    sb.from('patients').select('id,full_name').order('full_name').then(({ data }) => {
      setPatients(data ?? [])
      if (data?.length) setF(x => ({ ...x, patient_id: data[0].id }))
    })
    sb.from('plan_templates').select('*, plan_template_stages(id,description,estimated_cost)').order('name').then(({ data }) => setTemplates(data ?? []))
  }, [])

  function applyTemplate(e) {
    const templateId = e.target.value
    const tpl = templates.find(t => t.id === templateId)
    setF(x => ({
      ...x, template_id: templateId,
      plan_description: tpl ? (tpl.description || tpl.name) : x.plan_description,
      total_estimated_cost: tpl ? (tpl.plan_template_stages || []).reduce((a, s) => a + Number(s.estimated_cost || 0), 0) || x.total_estimated_cost : x.total_estimated_cost,
    }))
  }

  async function save() {
    if (!f.patient_id) return toast('Pick a patient.')
    const { data: plan, error } = await sb.from('treatment_plans').insert({
      patient_id: f.patient_id, plan_description: f.plan_description.trim() || null,
      total_estimated_cost: parseFloat(f.total_estimated_cost) || null,
    }).select().single()
    if (error) return toast('Error: ' + error.message)
    if (f.template_id) {
      const tpl = templates.find(t => t.id === f.template_id)
      const tplStages = tpl?.plan_template_stages ?? []
      if (tplStages.length) {
        const { error: sErr } = await sb.from('treatment_plan_stages').insert(
          tplStages.map((s, i) => ({ plan_id: plan.id, stage_number: i + 1, description: s.description, estimated_cost: s.estimated_cost }))
        )
        if (sErr) toast('Plan created, but stages failed: ' + sErr.message)
      }
    }
    toast('Plan created'); onDone()
  }

  return (
    <Modal title="New treatment plan" onClose={onClose}>
      <label>Patient *</label>
      <select value={f.patient_id} onChange={set('patient_id')}>
        {patients.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
      </select>
      {templates.length > 0 && (
        <>
          <label>Start from template (optional)</label>
          <select value={f.template_id} onChange={applyTemplate}>
            <option value="">—</option>
            {templates.map(t => <option key={t.id} value={t.id}>{t.name} ({(t.plan_template_stages || []).length} stages)</option>)}
          </select>
        </>
      )}
      <label>Description</label><textarea rows={2} value={f.plan_description} onChange={set('plan_description')} />
      <label>Estimated total cost (INR)</label><input type="number" value={f.total_estimated_cost} onChange={set('total_estimated_cost')} />
      <button className="btn" onClick={save}>Save plan</button>
    </Modal>
  )
}

function TemplatesManager({ onClose }) {
  const [templates, setTemplates] = useState(null)
  const [showNew, setShowNew] = useState(false)
  const [detail, setDetail] = useState(null)
  const toast = useToast()

  async function load() {
    const { data, error } = await sb.from('plan_templates').select('*, plan_template_stages(id)').order('name')
    if (error) { toast('Error: ' + error.message); return setTemplates([]) }
    setTemplates(data ?? [])
  }
  useEffect(() => { load() }, [])

  async function removeTemplate(id) {
    const { error } = await sb.from('plan_templates').delete().eq('id', id)
    if (error) return toast('Error: ' + error.message)
    toast('Template deleted'); load()
  }

  return (
    <Modal title="Treatment plan templates" onClose={onClose}>
      <p style={{ fontSize: '.78rem', color: 'var(--mid)', marginBottom: '.75rem' }}>
        Reusable stage presets for common multi-stage procedures — pick one when creating a new plan.
      </p>
      <button className="btn sm" style={{ marginBottom: '.75rem' }} onClick={() => setShowNew(true)}>+ New template</button>
      {templates === null ? <p style={{ fontSize: '.78rem' }}>Loading…</p> : !templates.length ? (
        <div className="empty">No templates yet.</div>
      ) : (
        <table className="tbl">
          <thead><tr><th>Name</th><th>Stages</th><th></th></tr></thead>
          <tbody>{templates.map(t => (
            <tr key={t.id}>
              <td className="link" onClick={() => setDetail(t.id)}>{t.name}</td>
              <td>{(t.plan_template_stages || []).length}</td>
              <td>
                <button className="btn sm ghost" onClick={() => setDetail(t.id)}>Edit stages</button>{' '}
                <button className="btn sm ghost danger" onClick={() => removeTemplate(t.id)}>Delete</button>
              </td>
            </tr>
          ))}</tbody>
        </table>
      )}
      {showNew && <NewTemplateForm onClose={() => setShowNew(false)} onDone={() => { setShowNew(false); load() }} />}
      {detail && <TemplateDetail id={detail} onClose={() => setDetail(null)} onChanged={load} />}
    </Modal>
  )
}

function NewTemplateForm({ onClose, onDone }) {
  const [f, setF] = useState({ name: '', description: '' })
  const toast = useToast()
  async function save() {
    if (!f.name.trim()) return toast('Name required.')
    const { error } = await sb.from('plan_templates').insert({ name: f.name.trim(), description: f.description.trim() || null })
    if (error) return toast('Error: ' + error.message)
    toast('Template created'); onDone()
  }
  return (
    <Modal title="New template" onClose={onClose}>
      <label>Name *</label><input placeholder="Full mouth implants" value={f.name} onChange={e => setF(x => ({ ...x, name: e.target.value }))} />
      <label>Description</label><input value={f.description} onChange={e => setF(x => ({ ...x, description: e.target.value }))} />
      <button className="btn" onClick={save}>Save template</button>
    </Modal>
  )
}

function TemplateDetail({ id, onClose, onChanged }) {
  const [template, setTemplate] = useState(null)
  const [stages, setStages] = useState(null)
  const [showStage, setShowStage] = useState(false)
  const toast = useToast()

  async function load() {
    const { data: t } = await sb.from('plan_templates').select('*').eq('id', id).single()
    const { data: s } = await sb.from('plan_template_stages').select('*').eq('template_id', id).order('stage_number')
    setTemplate(t); setStages(s ?? [])
  }
  useEffect(() => { load() }, [id])

  async function removeStage(stageId) {
    const { error } = await sb.from('plan_template_stages').delete().eq('id', stageId)
    if (error) return toast('Error: ' + error.message)
    load(); onChanged()
  }

  if (!template || !stages) return null
  return (
    <Modal title={'Template — ' + template.name} onClose={onClose}>
      <button className="btn sm" style={{ marginBottom: '.75rem' }} onClick={() => setShowStage(true)}>+ Add stage</button>
      {!stages.length ? <div className="empty">No stages yet.</div> : (
        <table className="tbl">
          <thead><tr><th>#</th><th>Description</th><th>Est. cost</th><th></th></tr></thead>
          <tbody>{stages.map(s => (
            <tr key={s.id}>
              <td>{s.stage_number}</td><td>{s.description || '—'}</td><td>{inr(s.estimated_cost)}</td>
              <td><button className="btn sm ghost danger" onClick={() => removeStage(s.id)}>Delete</button></td>
            </tr>
          ))}</tbody>
        </table>
      )}
      {showStage && (
        <TemplateStageForm templateId={id} nextNum={(stages.length || 0) + 1}
          onClose={() => setShowStage(false)} onDone={() => { setShowStage(false); load(); onChanged() }} />
      )}
    </Modal>
  )
}

function TemplateStageForm({ templateId, nextNum, onClose, onDone }) {
  const [f, setF] = useState({ stage_number: nextNum, description: '', estimated_cost: '' })
  const toast = useToast()
  const set = k => e => setF(x => ({ ...x, [k]: e.target.value }))
  async function save() {
    const { error } = await sb.from('plan_template_stages').insert({
      template_id: templateId, stage_number: parseInt(f.stage_number) || nextNum,
      description: f.description.trim() || null, estimated_cost: parseFloat(f.estimated_cost) || null,
    })
    if (error) return toast('Error: ' + error.message)
    toast('Stage added'); onDone()
  }
  return (
    <Modal title="Add template stage" onClose={onClose}>
      <label>Stage number</label><input type="number" value={f.stage_number} onChange={set('stage_number')} />
      <label>Description</label><input value={f.description} onChange={set('description')} />
      <label>Estimated cost</label><input type="number" value={f.estimated_cost} onChange={set('estimated_cost')} />
      <button className="btn" onClick={save}>Save stage</button>
    </Modal>
  )
}

function PlanDetail({ id, onClose, onChanged }) {
  const [plan, setPlan] = useState(null)
  const [stages, setStages] = useState(null)
  const [appts, setAppts] = useState([])
  const [showStage, setShowStage] = useState(false)
  const [confirmDel, setConfirmDel] = useState(null)
  const [logStage, setLogStage] = useState(null)
  const [loggedByStage, setLoggedByStage] = useState({})
  const [showApproval, setShowApproval] = useState(false)
  const toast = useToast()
  const role = useRole()
  const canDeleteStage = role === 'admin' || role === 'doctor'

  async function load() {
    const { data: p } = await sb.from('treatment_plans').select('*, patients(id,full_name)').eq('id', id).single()
    const { data: s } = await sb.from('treatment_plan_stages').select('*').eq('plan_id', id).order('stage_number')
    setPlan(p); setStages(s ?? [])
    if (p) {
      const { data } = await sb.from('appointments').select('id, appointment_time').eq('patient_id', p.patient_id).order('appointment_time', { ascending: false })
      setAppts(data ?? [])
      const stageIds = (s ?? []).map(x => x.id)
      if (stageIds.length) {
        const { data: recs } = await sb.from('treatment_records').select('id, stage_id').in('stage_id', stageIds)
        const byStage = {}
        ;(recs ?? []).forEach(r => { byStage[r.stage_id] = r.id })
        setLoggedByStage(byStage)
      }
    }
  }
  useEffect(() => { load() }, [id])

  async function setStageStatus(stage, status) {
    const { error } = await sb.from('treatment_plan_stages').update({ status }).eq('id', stage.id)
    if (error) return toast('Error: ' + error.message)
    toast('Stage ' + status); load(); onChanged()
  }
  async function linkAppt(stage, appointment_id) {
    const { error } = await sb.from('treatment_plan_stages').update({ appointment_id: appointment_id || null }).eq('id', stage.id)
    if (error) return toast('Error: ' + error.message)
    load(); onChanged()
  }
  async function removeStage(stage) {
    const { error } = await sb.from('treatment_plan_stages').delete().eq('id', stage.id)
    if (error) return toast('Error: ' + error.message)
    toast('Stage deleted'); load(); onChanged()
  }
  async function approvePlan(signatureData) {
    const { error } = await sb.from('treatment_plans').update({
      patient_approved: true, patient_signature_data: signatureData, approved_date: new Date().toISOString(),
    }).eq('id', id)
    if (error) return toast('Error: ' + error.message)
    logActivity('plan.approved', 'treatment_plan', id, `${plan.patients?.full_name || 'Patient'} approved treatment plan "${plan.plan_description || id}"`)
    toast('Plan approved by patient'); setShowApproval(false); load(); onChanged()
  }

  if (!plan || !stages) return null
  return (
    <Modal title={'Plan — ' + plan.patients?.full_name} onClose={onClose}>
      <p style={{ fontSize: '.78rem', color: 'var(--mid)', marginBottom: '.5rem' }}>{plan.plan_description || 'No description'}</p>
      <p style={{ fontSize: '.78rem', marginBottom: '.75rem' }}>Estimated cost: <b>{inr(plan.total_estimated_cost)}</b>{' '}
        <a className="btn sm ghost" target="_blank" rel="noreferrer" href={'/print/plan/' + id}>Print estimate</a>
      </p>
      {plan.patient_approved ? (
        <p style={{ fontSize: '.78rem', marginBottom: '1rem' }}>
          <span className="badge b-completed">approved</span> by patient on {fmtD(plan.approved_date)}
        </p>
      ) : (
        <button className="btn sm ghost" style={{ marginBottom: '1rem' }} onClick={() => setShowApproval(true)}>Get patient approval</button>
      )}
      <button className="btn sm" style={{ marginBottom: '.75rem' }} onClick={() => setShowStage(true)}>+ Add stage</button>
      {!stages.length ? <div className="empty">No stages yet.</div> : (
        <table className="tbl">
          <thead><tr><th>#</th><th>Description</th><th>Cost</th><th>Appointment</th><th>Status</th><th></th></tr></thead>
          <tbody>{stages.map(s => (
            <tr key={s.id}>
              <td>{s.stage_number}</td><td>{s.description || '—'}</td><td>{inr(s.estimated_cost)}</td>
              <td>
                <select value={s.appointment_id || ''} onChange={e => linkAppt(s, e.target.value)}>
                  <option value="">—</option>
                  {appts.map(a => <option key={a.id} value={a.id}>{fmtD(a.appointment_time)}</option>)}
                </select>
              </td>
              <td><StatusSelect value={s.status} options={STAGE_STATUSES} onChange={st => setStageStatus(s, st)} /></td>
              <td>
                {loggedByStage[s.id]
                  ? <span className="badge b-completed">logged</span>
                  : <button className="btn sm ghost" onClick={() => setLogStage(s)}>Log treatment</button>}{' '}
                {canDeleteStage && <button className="btn sm ghost danger" onClick={() => setConfirmDel(s)}>Delete</button>}
              </td>
            </tr>
          ))}</tbody>
        </table>
      )}
      {showStage && <StageForm planId={id} nextNum={(stages.length || 0) + 1} onClose={() => setShowStage(false)} onDone={() => { setShowStage(false); load(); onChanged() }} />}
      {confirmDel && <ConfirmDialog title="Delete this stage?" onCancel={() => setConfirmDel(null)}
        onConfirm={() => { removeStage(confirmDel); setConfirmDel(null) }} />}
      {logStage && <RecordForm patientId={plan.patient_id} stageId={logStage.id} onClose={() => setLogStage(null)}
        onDone={async () => { await setStageStatus(logStage, 'completed'); setLogStage(null) }} />}
      {showApproval && (
        <Modal title="Patient approval" onClose={() => setShowApproval(false)}>
          <p style={{ fontSize: '.78rem', color: 'var(--mid)', marginBottom: '.75rem' }}>
            Have the patient sign below to confirm they accept this treatment plan and its estimated cost.
          </p>
          <SignaturePad onSave={approvePlan} onCancel={() => setShowApproval(false)} />
        </Modal>
      )}
    </Modal>
  )
}

function StageForm({ planId, nextNum, onClose, onDone }) {
  const [f, setF] = useState({ stage_number: nextNum, description: '', estimated_cost: '' })
  const toast = useToast()
  const set = k => e => setF(x => ({ ...x, [k]: e.target.value }))
  async function save() {
    const { error } = await sb.from('treatment_plan_stages').insert({
      plan_id: planId, stage_number: parseInt(f.stage_number) || nextNum,
      description: f.description.trim() || null, estimated_cost: parseFloat(f.estimated_cost) || null,
    })
    if (error) return toast('Error: ' + error.message)
    toast('Stage added'); onDone()
  }
  return (
    <Modal title="Add stage" onClose={onClose}>
      <label>Stage number</label><input type="number" value={f.stage_number} onChange={set('stage_number')} />
      <label>Description</label><input value={f.description} onChange={set('description')} />
      <label>Estimated cost</label><input type="number" value={f.estimated_cost} onChange={set('estimated_cost')} />
      <button className="btn" onClick={save}>Save stage</button>
    </Modal>
  )
}
