import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { fmtD, fmtDT, inr, digits, today } from '../lib/format'
import { useToast } from '../components/Toast'
import Modal from '../components/Modal'
import ConfirmDialog from '../components/ConfirmDialog'
import CancelReasonDialog from '../components/CancelReasonDialog'
import StatusSelect from '../components/StatusSelect'
import ToothChart, { TOOTH_CONDITIONS } from '../components/ToothChart'
import XRayPanel from '../components/XRayPanel'
import PatientDocumentsPanel from '../components/PatientDocumentsPanel'
import TreatmentRecordPanel from '../components/TreatmentRecordPanel'
import PerioChart from '../components/PerioChart'
import { PatientForm } from './Patients'
import { AppointmentForm, APPT_STATUSES, completeAppointment } from './Appointments'
import { useRole } from '../lib/RoleContext'
import { logActivity } from '../lib/activityLog'

const TABS = ['Overview', 'Tooth Chart', 'Medical History', 'Appointments', 'Prescriptions', 'Invoices', 'X-Rays', 'Treatment Records', 'Perio Chart', 'Documents']

export default function PatientDetail() {
  const { id } = useParams()
  const [d, setD] = useState(null)
  const [tab, setTab] = useState(0)
  const [modal, setModal] = useState(null) // {type, payload}
  const [reasonPrompt, setReasonPrompt] = useState(null)
  const toast = useToast()
  const role = useRole()
  const nav = useNavigate()

  async function load() {
    const [p, mh, teeth, appts, rx, inv, docs] = await Promise.all([
      sb.from('patients').select('*').eq('id', id).single(),
      sb.from('medical_history').select('*').eq('patient_id', id).order('updated_at', { ascending: false }).limit(1),
      sb.from('tooth_chart').select('*').eq('patient_id', id),
      sb.from('appointments').select('*, staff(full_name), treatments(name)').eq('patient_id', id).order('appointment_time', { ascending: false }),
      sb.from('prescriptions').select('*, staff(full_name)').eq('patient_id', id).order('prescribed_date', { ascending: false }),
      sb.from('invoices').select('*, staff(full_name)').eq('patient_id', id).order('invoice_date', { ascending: false }),
      sb.from('staff').select('*').eq('active', true).eq('role', 'doctor').order('full_name'),
    ])
    setD({ p: p.data, mh: mh.data?.[0] || null, teeth: teeth.data ?? [], appts: appts.data ?? [], rx: rx.data ?? [], inv: inv.data ?? [], docs: docs.data ?? [] })
  }
  useEffect(() => { load() }, [id])

  if (!d?.p) return <div className="empty">Loading…</div>
  const { p } = d
  if (p.merged_into) return <MergedBanner mergedInto={p.merged_into} />

  async function setApptStatus(a, status, reason = null) {
    const rec = { status }
    if (reason !== null) rec.status_reason = reason
    const { error } = await sb.from('appointments').update(rec).eq('id', a.id)
    if (error) return toast('Error: ' + error.message)
    if (status === 'completed') { await completeAppointment(id); toast('Visit completed · recall scheduled') }
    load()
  }
  function onApptStatusChange(a, status) {
    if (status === 'cancelled' || status === 'no_show') setReasonPrompt({ a, status }); else setApptStatus(a, status)
  }
  async function setInvStatus(vid, status) {
    const { error } = await sb.from('invoices').update({ payment_status: status }).eq('id', vid)
    if (error) return toast('Error: ' + error.message)
    toast('Invoice ' + status); load()
  }

  return (
    <>
      {d.mh?.allergies && (
        <div className="allergy-alert">⚠ Allergy: {d.mh.allergies}</div>
      )}
      <div className="pd-head">
        <div>
          <h3>{p.full_name}{(p.tags || []).map(t => <span key={t} className="badge b-partial" style={{ marginLeft: '.5rem' }}>{t}</span>)}</h3>
          <div className="sub">
            {p.phone}{p.email && ' · ' + p.email}{p.date_of_birth && ' · DOB ' + fmtD(p.date_of_birth)}{p.gender && ' · ' + p.gender}<br />
            {p.address && <>{p.address}<br /></>}
            Registered {fmtD(p.created_at)} · Consent {p.consent_given ? '✓ ' + fmtD(p.consent_date) : '✗'}
            {p.referral_source && <> · via {p.referral_source}</>}
          </div>
        </div>
        <div>
          <button className="btn ghost sm" onClick={() => setModal({ type: 'edit' })}>Edit</button>{' '}
          <a className="btn sm green" target="_blank" rel="noreferrer" href={'https://wa.me/' + digits(p.phone)}>WhatsApp</a>
        </div>
      </div>

      <div className="tabs">
        {TABS.map((t, i) => (
          <button key={t} className={'tab' + (tab === i ? ' active' : '')} onClick={() => setTab(i)}>{t}</button>
        ))}
      </div>

      {tab === 0 && (
        <>
          <div className="stats">
            <div className="stat"><b>{d.appts.length}</b><span>Appointments</span></div>
            <div className="stat pink"><b>{d.teeth.filter(t => t.condition && t.condition !== 'Healthy').length}</b><span>Teeth flagged</span></div>
            <div className="stat gold"><b>{d.rx.length}</b><span>Prescriptions</span></div>
            <div className="stat green"><b>{inr(d.inv.filter(v => v.payment_status === 'paid').reduce((a, v) => a + Number(v.amount), 0))}</b><span>Paid to date</span></div>
          </div>
          <button className="btn" onClick={() => setModal({ type: 'appt' })}>+ Appointment</button>{' '}
          <button className="btn ghost" onClick={() => setModal({ type: 'rx' })}>+ Prescription</button>{' '}
          <button className="btn ghost" onClick={() => setModal({ type: 'inv' })}>+ Invoice</button>
          <div className="overview-card">
            <FamilySection patient={p} onChanged={load} />
            {(role === 'admin' || role === 'doctor') && <MergeDuplicateSection patient={p} onMerged={load} />}
          </div>
        </>
      )}

      {tab === 1 && <ToothChart teeth={d.teeth} onSelect={(n, t) => setModal({ type: 'tooth', n, t })} />}

      {tab === 2 && <MedicalHistory patientId={id} mh={d.mh} onSaved={load} />}

      {tab === 3 && (
        <>
          <button className="btn" style={{ marginBottom: '.75rem' }} onClick={() => setModal({ type: 'appt' })}>+ New appointment</button>
          {!d.appts.length ? <div className="empty">No appointments.</div> : (
            <table className="tbl">
              <thead><tr><th>When</th><th>Doctor</th><th>Treatment</th><th>Room</th><th>Status</th></tr></thead>
              <tbody>{d.appts.map(a => (
                <tr key={a.id}>
                  <td>{fmtDT(a.appointment_time)}</td><td>{a.staff?.full_name || '—'}</td>
                  <td>{a.treatments?.name || '—'}</td><td>{a.floor_room || '—'}</td>
                  <td>
                    <StatusSelect value={a.status} options={APPT_STATUSES} onChange={s => onApptStatusChange(a, s)} />
                    {a.status_reason && <div style={{ fontSize: '.66rem', color: 'var(--soft)', marginTop: '.2rem' }}>{a.status_reason}</div>}
                  </td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </>
      )}

      {tab === 4 && (
        <>
          <button className="btn" style={{ marginBottom: '.75rem' }} onClick={() => setModal({ type: 'rx' })}>+ New prescription</button>
          {!d.rx.length ? <div className="empty">No prescriptions.</div> : (
            <table className="tbl">
              <thead><tr><th>Date</th><th>Medicine</th><th>Dosage</th><th>Duration</th><th>By</th><th></th></tr></thead>
              <tbody>{d.rx.map(r => (
                <tr key={r.id}>
                  <td>{fmtD(r.prescribed_date)}</td><td>{r.medicine_name}</td>
                  <td>{r.dosage || '—'}</td><td>{r.duration || '—'}</td><td>{r.staff?.full_name || '—'}</td>
                  <td><a className="btn sm ghost" target="_blank" rel="noreferrer" href={'/print/prescription/' + r.id}>Print</a></td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </>
      )}

      {tab === 5 && <Ledger inv={d.inv} onNew={() => setModal({ type: 'inv' })} onStatus={setInvStatus} />}

      {tab === 6 && <XRayPanel patientId={id} />}

      {tab === 7 && <TreatmentRecordPanel patientId={id} />}

      {tab === 8 && <PerioChart patientId={id} />}

      {tab === 9 && <PatientDocumentsPanel patientId={id} />}

      {modal?.type === 'edit' && <PatientForm patient={p} onClose={() => setModal(null)} onDone={() => { setModal(null); load() }} />}
      {modal?.type === 'appt' && <AppointmentForm patientId={id} onClose={() => setModal(null)} onDone={() => { setModal(null); load() }} />}
      {modal?.type === 'tooth' && <ToothForm patientId={id} n={modal.n} t={modal.t} doctors={d.docs} onClose={() => setModal(null)} onDone={() => { setModal(null); load() }} />}
      {modal?.type === 'rx' && <RxForm patientId={id} doctors={d.docs} allergies={d.mh?.allergies} onClose={() => setModal(null)} onDone={() => { setModal(null); load() }} />}
      {modal?.type === 'inv' && <InvoiceForm patientId={id} doctors={d.docs} onClose={() => setModal(null)} onDone={() => { setModal(null); load() }} />}
      {reasonPrompt && (
        <CancelReasonDialog status={reasonPrompt.status} onCancel={() => setReasonPrompt(null)}
          onConfirm={reason => { setApptStatus(reasonPrompt.a, reasonPrompt.status, reason); setReasonPrompt(null) }} />
      )}
    </>
  )
}

function MergedBanner({ mergedInto }) {
  const [primary, setPrimary] = useState(null)
  const nav = useNavigate()
  useEffect(() => {
    sb.from('patients').select('id,full_name').eq('id', mergedInto).maybeSingle().then(({ data }) => setPrimary(data))
  }, [mergedInto])
  return (
    <div className="allergy-alert" style={{ cursor: primary ? 'pointer' : 'default' }} onClick={() => primary && nav('/patients/' + primary.id)}>
      This patient record was merged into {primary?.full_name || 'another patient'} — click to view the merged record.
    </div>
  )
}

// Admin/doctor only — lets a duplicate patient record be folded into this
// one via the merge_patients() Postgres function (see migration 011).
function MergeDuplicateSection({ patient, onMerged }) {
  const [show, setShow] = useState(false)
  return (
    <div style={{ marginTop: '1.25rem' }}>
      <button className="btn sm ghost" onClick={() => setShow(true)}>Merge a duplicate into this patient</button>
      {show && <MergeDuplicateForm patient={patient} onClose={() => setShow(false)} onDone={() => { setShow(false); onMerged() }} />}
    </div>
  )
}

function MergeDuplicateForm({ patient, onClose, onDone }) {
  const [patients, setPatients] = useState([])
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState(null)
  const [busy, setBusy] = useState(false)
  const toast = useToast()

  useEffect(() => {
    sb.from('patients').select('id,full_name,phone').neq('id', patient.id).is('merged_into', null).order('full_name')
      .then(({ data }) => setPatients(data ?? []))
  }, [])

  const view = patients.filter(p => !q || p.full_name.toLowerCase().includes(q.toLowerCase()) || (p.phone || '').includes(q))

  async function pick(p) {
    setBusy(true)
    const [appts, inv, recs] = await Promise.all([
      sb.from('appointments').select('id', { count: 'exact', head: true }).eq('patient_id', p.id),
      sb.from('invoices').select('id', { count: 'exact', head: true }).eq('patient_id', p.id),
      sb.from('treatment_records').select('id', { count: 'exact', head: true }).eq('patient_id', p.id),
    ])
    setBusy(false)
    setPicked({ ...p, apptCount: appts.count ?? 0, invCount: inv.count ?? 0, recCount: recs.count ?? 0 })
  }

  async function doMerge() {
    setBusy(true)
    const { error } = await sb.rpc('merge_patients', { primary_id: patient.id, duplicate_id: picked.id })
    setBusy(false)
    if (error) return toast('Error: ' + error.message)
    logActivity('patient.merged', 'patients', picked.id, `Merged ${picked.full_name} into ${patient.full_name}`)
    toast('Patients merged'); onDone()
  }

  return (
    <Modal title={picked ? 'Confirm merge' : 'Merge a duplicate patient'} onClose={onClose}>
      {!picked ? (
        <>
          <label>Search for the duplicate record</label>
          <input placeholder="Name or phone" value={q} onChange={e => setQ(e.target.value)} />
          {!view.length ? <p style={{ fontSize: '.78rem', color: 'var(--soft)', marginTop: '.75rem' }}>No matches.</p> : (
            <table className="tbl" style={{ marginTop: '.75rem' }}>
              <thead><tr><th>Name</th><th>Phone</th><th></th></tr></thead>
              <tbody>{view.slice(0, 20).map(p => (
                <tr key={p.id}>
                  <td>{p.full_name}</td><td>{p.phone}</td>
                  <td><button className="btn sm ghost" disabled={busy} onClick={() => pick(p)}>Select</button></td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </>
      ) : (
        <>
          <p style={{ fontSize: '.85rem', marginBottom: '.75rem' }}>Merge <b>{picked.full_name}</b> into <b>{patient.full_name}</b>?</p>
          <p style={{ fontSize: '.78rem', color: 'var(--mid)', marginBottom: '.75rem' }}>
            This moves {picked.apptCount} appointment(s), {picked.invCount} invoice(s), {picked.recCount} treatment record(s)
            — and everything else on {picked.full_name}'s record — onto {patient.full_name}. {picked.full_name}'s record will
            be marked as merged and hidden from the patient list. <b>This cannot be undone.</b>
          </p>
          <div style={{ display: 'flex', gap: '.75rem' }}>
            <button className="btn ghost" onClick={() => setPicked(null)}>Back</button>
            <button className="btn danger" disabled={busy} onClick={doMerge}>{busy ? 'Merging…' : 'Merge patients'}</button>
          </div>
        </>
      )}
    </Modal>
  )
}

function FamilySection({ patient, onChanged }) {
  const [members, setMembers] = useState([])
  const [show, setShow] = useState(false)
  const toast = useToast()
  const nav = useNavigate()
  const rootId = patient.family_head_id || patient.id

  async function load() {
    const { data, error } = await sb.from('patients').select('id, full_name, phone')
      .or(`family_head_id.eq.${rootId},id.eq.${rootId}`).neq('id', patient.id)
    if (error) return
    setMembers(data ?? [])
  }
  useEffect(() => { load() }, [patient.id, patient.family_head_id])

  async function link(otherId) {
    const { error } = await sb.from('patients').update({ family_head_id: rootId }).eq('id', otherId)
    if (error) return toast('Error: ' + error.message)
    toast('Linked'); load(); onChanged()
  }
  async function unlink() {
    const { error } = await sb.from('patients').update({ family_head_id: null }).eq('id', patient.id)
    if (error) return toast('Error: ' + error.message)
    toast('Removed from family'); load(); onChanged()
  }

  return (
    <div style={{ maxWidth: 480 }}>
      <label>Family</label>
      {!members.length ? (
        <p style={{ fontSize: '.78rem', color: 'var(--soft)' }}>No linked family members.</p>
      ) : (
        <table className="tbl">
          <thead><tr><th>Name</th><th>Phone</th></tr></thead>
          <tbody>{members.map(m => (
            <tr key={m.id}>
              <td className="link" onClick={() => nav('/patients/' + m.id)}>{m.full_name}</td>
              <td>{m.phone}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
      <button className="btn sm ghost" style={{ marginTop: '.5rem' }} onClick={() => setShow(true)}>+ Link family member</button>{' '}
      {patient.family_head_id && <button className="btn sm ghost danger" onClick={unlink}>Remove from this family</button>}
      {show && <LinkFamilyForm excludeId={patient.id} onClose={() => setShow(false)} onDone={otherId => { setShow(false); link(otherId) }} />}
    </div>
  )
}

function LinkFamilyForm({ excludeId, onClose, onDone }) {
  const [patients, setPatients] = useState([])
  const [q, setQ] = useState('')

  useEffect(() => {
    sb.from('patients').select('id,full_name,phone').neq('id', excludeId).order('full_name').then(({ data }) => setPatients(data ?? []))
  }, [])

  const view = patients.filter(p => !q || p.full_name.toLowerCase().includes(q.toLowerCase()) || (p.phone || '').includes(q))

  return (
    <Modal title="Link family member" onClose={onClose}>
      <label>Search existing patient</label>
      <input placeholder="Name or phone" value={q} onChange={e => setQ(e.target.value)} />
      {!view.length ? <p style={{ fontSize: '.78rem', color: 'var(--soft)', marginTop: '.75rem' }}>No matches.</p> : (
        <table className="tbl" style={{ marginTop: '.75rem' }}>
          <thead><tr><th>Name</th><th>Phone</th><th></th></tr></thead>
          <tbody>{view.slice(0, 20).map(r => (
            <tr key={r.id}>
              <td>{r.full_name}</td><td>{r.phone}</td>
              <td><button className="btn sm ghost" onClick={() => onDone(r.id)}>Link</button></td>
            </tr>
          ))}</tbody>
        </table>
      )}
    </Modal>
  )
}

// Chronological account statement — running balance, oldest first, so a
// patient's "what do I owe" question can be answered from one screen.
function Ledger({ inv, onNew, onStatus }) {
  const billed = v => Number(v.amount) + Number(v.tax_amount || 0)
  const totalBilled = inv.reduce((a, v) => a + billed(v), 0)
  const totalPaid = inv.filter(v => v.payment_status === 'paid').reduce((a, v) => a + billed(v), 0)
  const outstanding = inv.filter(v => v.payment_status === 'pending' || v.payment_status === 'partial').reduce((a, v) => a + billed(v), 0)
  const asc = [...inv].sort((a, b) => new Date(a.invoice_date) - new Date(b.invoice_date))
  let running = 0

  return (
    <>
      <button className="btn" style={{ marginBottom: '.75rem' }} onClick={onNew}>+ New invoice</button>
      {!inv.length ? <div className="empty">No invoices.</div> : (
        <>
          <div className="stats" style={{ marginBottom: '.75rem' }}>
            <div className="stat"><b>{inr(totalBilled)}</b><span>Total billed</span></div>
            <div className="stat green"><b>{inr(totalPaid)}</b><span>Paid</span></div>
            <div className="stat pink"><b>{inr(outstanding)}</b><span>Balance due</span></div>
          </div>
          <table className="tbl">
            <thead><tr><th>Date</th><th>Amount</th><th>Method</th><th>Doctor</th><th>Status</th><th>Balance due</th><th></th></tr></thead>
            <tbody>{asc.map(v => {
              if (v.payment_status !== 'paid' && v.payment_status !== 'refunded') running += billed(v)
              return (
                <tr key={v.id}>
                  <td>{fmtD(v.invoice_date)}</td><td>{inr(billed(v))}</td><td>{v.payment_method || '—'}</td>
                  <td>{v.staff?.full_name || '—'}</td>
                  <td><StatusSelect value={v.payment_status} options={['pending', 'partial', 'paid', 'refunded']} onChange={s => onStatus(v.id, s)} /></td>
                  <td>{inr(running)}</td>
                  <td><a className="btn sm ghost" target="_blank" rel="noreferrer" href={'/print/invoice/' + v.id}>Print</a></td>
                </tr>
              )
            })}</tbody>
          </table>
        </>
      )}
    </>
  )
}

function MedicalHistory({ patientId, mh, onSaved }) {
  const [f, setF] = useState({
    condition: mh?.condition || '', allergies: mh?.allergies || '', current_medications: mh?.current_medications || '',
    pregnancy_status: mh?.pregnancy_status || false, notes: mh?.notes || '',
  })
  const toast = useToast()
  const set = k => e => setF(x => ({ ...x, [k]: e.target.value }))

  async function save() {
    const rec = {
      patient_id: patientId, condition: f.condition.trim() || null, allergies: f.allergies.trim() || null,
      current_medications: f.current_medications.trim() || null, pregnancy_status: f.pregnancy_status, notes: f.notes.trim() || null,
    }
    const q = mh?.id ? sb.from('medical_history').update(rec).eq('id', mh.id) : sb.from('medical_history').insert(rec)
    const { error } = await q
    if (error) return toast('Error: ' + error.message)
    toast('Medical history saved'); onSaved()
  }

  return (
    <div style={{ maxWidth: 640 }}>
      <div className="mrow">
        <div><label>Conditions</label><input placeholder="Diabetes, hypertension…" value={f.condition} onChange={set('condition')} /></div>
        <div><label>Allergies</label><input placeholder="Penicillin…" value={f.allergies} onChange={set('allergies')} /></div>
      </div>
      <label>Current medications</label><input value={f.current_medications} onChange={set('current_medications')} />
      <label style={{ display: 'flex', alignItems: 'center', gap: '.5rem', textTransform: 'none', fontSize: '.78rem', color: 'var(--ink)' }}>
        <input type="checkbox" style={{ width: 'auto' }} checked={f.pregnancy_status}
          onChange={e => setF(x => ({ ...x, pregnancy_status: e.target.checked }))} /> Pregnancy status
      </label>
      <label>Notes</label><textarea rows={2} value={f.notes} onChange={set('notes')} />
      <button className="btn" style={{ marginTop: '1rem' }} onClick={save}>Save medical history</button>
    </div>
  )
}

function ToothForm({ patientId, n, t, doctors, onClose, onDone }) {
  const [f, setF] = useState({ condition: t?.condition || 'Healthy', treating_doctor_id: t?.treating_doctor_id || '', notes: t?.notes || '' })
  const toast = useToast()
  async function save() {
    const rec = {
      patient_id: patientId, tooth_number: n, condition: f.condition,
      treating_doctor_id: f.treating_doctor_id || null, notes: f.notes.trim() || null, treatment_date: today(),
    }
    const q = t?.id ? sb.from('tooth_chart').update(rec).eq('id', t.id) : sb.from('tooth_chart').insert(rec)
    const { error } = await q
    if (error) return toast('Error: ' + error.message)
    toast(`Tooth ${n} saved`); onDone()
  }
  return (
    <Modal title={'Tooth ' + n} onClose={onClose}>
      <label>Condition</label>
      <select value={f.condition} onChange={e => setF(x => ({ ...x, condition: e.target.value }))}>
        {TOOTH_CONDITIONS.map(c => <option key={c}>{c}</option>)}
      </select>
      <label>Treating doctor</label>
      <select value={f.treating_doctor_id} onChange={e => setF(x => ({ ...x, treating_doctor_id: e.target.value }))}>
        <option value="">—</option>{doctors.map(d => <option key={d.id} value={d.id}>{d.full_name}</option>)}
      </select>
      <label>Notes</label><input value={f.notes} onChange={e => setF(x => ({ ...x, notes: e.target.value }))} />
      <button className="btn" onClick={save}>Save</button>
    </Modal>
  )
}

// Keyword match only — catches the patient's allergy word appearing literally
// in the medicine name (e.g. allergy "Penicillin" + medicine "Penicillin V").
// It will NOT catch cross-class reactions (e.g. Amoxicillin vs a Penicillin
// allergy) — that needs a real drug database, which is out of scope here.
function allergyHit(allergies, medicineName) {
  if (!allergies || !medicineName) return null
  const med = medicineName.toLowerCase()
  return (allergies.split(/[,;]/).map(a => a.trim()).filter(Boolean))
    .find(a => med.includes(a.toLowerCase()) || a.toLowerCase().includes(med)) || null
}

function RxForm({ patientId, doctors, allergies, onClose, onDone }) {
  const [f, setF] = useState({ medicine_name: '', dosage: '', duration: '', prescribed_by: '', notes: '' })
  const [allergyConfirm, setAllergyConfirm] = useState(null)
  const toast = useToast()
  const set = k => e => setF(x => ({ ...x, [k]: e.target.value }))
  async function doInsert() {
    const { error } = await sb.from('prescriptions').insert({
      patient_id: patientId, medicine_name: f.medicine_name.trim(), dosage: f.dosage.trim() || null,
      duration: f.duration.trim() || null, prescribed_by: f.prescribed_by || null, notes: f.notes.trim() || null,
    })
    if (error) return toast('Error: ' + error.message)
    toast('Prescription saved'); onDone()
  }
  async function save() {
    if (!f.medicine_name.trim()) return toast('Medicine name required.')
    const hit = allergyHit(allergies, f.medicine_name.trim())
    if (hit) return setAllergyConfirm(hit)
    doInsert()
  }
  return (
    <>
    <Modal title="New prescription" onClose={onClose}>
      {allergies && <div className="allergy-alert" style={{ marginBottom: '1rem' }}>⚠ Allergy on file: {allergies}</div>}
      <label>Medicine *</label><input value={f.medicine_name} onChange={set('medicine_name')} />
      <div className="mrow">
        <div><label>Dosage</label><input placeholder="500mg twice daily" value={f.dosage} onChange={set('dosage')} /></div>
        <div><label>Duration</label><input placeholder="5 days" value={f.duration} onChange={set('duration')} /></div>
      </div>
      <label>Prescribed by</label>
      <select value={f.prescribed_by} onChange={set('prescribed_by')}>
        <option value="">—</option>{doctors.map(d => <option key={d.id} value={d.id}>{d.full_name}</option>)}
      </select>
      <label>Notes</label><input value={f.notes} onChange={set('notes')} />
      <button className="btn" onClick={save}>Save prescription</button>
    </Modal>
    {allergyConfirm && (
      <ConfirmDialog title="Possible allergy conflict"
        body={`Patient has a recorded allergy to "${allergyConfirm}" — prescribe "${f.medicine_name.trim()}" anyway?`}
        confirmLabel="Prescribe anyway" onCancel={() => setAllergyConfirm(null)}
        onConfirm={() => { setAllergyConfirm(null); doInsert() }} />
    )}
    </>
  )
}

function InvoiceForm({ patientId, doctors, onClose, onDone }) {
  const [f, setF] = useState({ amount: '', tax_amount: '', payment_method: '', doctor_id: '', notes: '' })
  const toast = useToast()
  const set = k => e => setF(x => ({ ...x, [k]: e.target.value }))
  async function save() {
    const amt = parseFloat(f.amount)
    if (!amt) return toast('Enter an amount.')
    const { error } = await sb.from('invoices').insert({
      patient_id: patientId, amount: amt, tax_amount: parseFloat(f.tax_amount) || null,
      payment_method: f.payment_method || null, doctor_id: f.doctor_id || null, notes: f.notes.trim() || null,
    })
    if (error) return toast('Error: ' + error.message)
    toast('Invoice created'); onDone()
  }
  return (
    <Modal title="New invoice" onClose={onClose}>
      <div className="mrow">
        <div><label>Amount (INR) *</label><input type="number" value={f.amount} onChange={set('amount')} /></div>
        <div><label>Tax (optional)</label><input type="number" placeholder="If applicable" value={f.tax_amount} onChange={set('tax_amount')} /></div>
      </div>
      <div className="mrow">
        <div><label>Payment method</label>
          <select value={f.payment_method} onChange={set('payment_method')}>
            <option value="">—</option><option>cash</option><option>card</option><option>upi</option><option>insurance</option>
          </select>
        </div>
        <div><label>Treating doctor</label>
          <select value={f.doctor_id} onChange={set('doctor_id')}>
            <option value="">—</option>{(doctors || []).map(d => <option key={d.id} value={d.id}>{d.full_name}</option>)}
          </select>
        </div>
      </div>
      <label>Notes</label><input value={f.notes} onChange={set('notes')} />
      <button className="btn" onClick={save}>Save invoice</button>
    </Modal>
  )
}
