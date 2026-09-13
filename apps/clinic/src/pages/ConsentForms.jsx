import { useEffect, useState } from 'react'
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
    const { data, error } = await sb.from('consent_forms').select('*, patients(id,full_name)')
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
        <button className="btn" onClick={() => setShow(true)}>+ New form</button>
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
              <td>{c.signed_date ? fmtD(c.signed_date) : '—'}</td>
              <td>
                {!c.consent_given && <button className="btn sm ghost" onClick={() => setSign(c)}>Mark signed</button>}{' '}
                {c.document_url && <a className="btn sm ghost" target="_blank" rel="noreferrer" href={c.document_url}>Document</a>}{' '}
                <a className="btn sm ghost" target="_blank" rel="noreferrer" href={'/print/consent/' + c.id}>Print</a>{' '}
                <button className="btn sm ghost danger" onClick={() => setConfirmDel(c.id)}>Delete</button>
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

function ConsentFormForm({ onClose, onDone }) {
  const [patients, setPatients] = useState([])
  const [f, setF] = useState({ patient_id: '', procedure: '', document_url: '' })
  const toast = useToast()
  const set = k => e => setF(x => ({ ...x, [k]: e.target.value }))

  useEffect(() => {
    sb.from('patients').select('id,full_name').order('full_name').then(({ data }) => {
      setPatients(data ?? [])
      if (data?.length) setF(x => ({ ...x, patient_id: data[0].id }))
    })
  }, [])

  async function save() {
    if (!f.patient_id) return toast('Pick a patient.')
    if (!f.procedure.trim()) return toast('Procedure required.')
    const { error } = await sb.from('consent_forms').insert({
      patient_id: f.patient_id, procedure: f.procedure.trim(), document_url: f.document_url.trim() || null,
    })
    if (error) return toast('Error: ' + error.message)
    toast('Consent form created'); onDone()
  }

  return (
    <Modal title="New consent form" onClose={onClose}>
      <label>Patient *</label>
      <select value={f.patient_id} onChange={set('patient_id')}>
        {patients.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
      </select>
      <label>Procedure *</label><input placeholder="Root canal treatment" value={f.procedure} onChange={set('procedure')} />
      <label>Document URL (optional)</label><input placeholder="Link to scanned form" value={f.document_url} onChange={set('document_url')} />
      <button className="btn" onClick={save}>Save form</button>
    </Modal>
  )
}

function SignForm({ form, onClose, onDone }) {
  const [documentUrl, setDocumentUrl] = useState(form.document_url || '')
  const [signature, setSignature] = useState(null)
  const toast = useToast()

  async function save() {
    const { error } = await sb.from('consent_forms').update({
      consent_given: true, signed_date: new Date().toISOString(),
      document_url: documentUrl.trim() || null, signature_data: signature || null,
    }).eq('id', form.id)
    if (error) return toast('Error: ' + error.message)
    logActivity('consent.signed', 'consent_form', form.id, `${form.patients?.full_name || 'Patient'} signed consent for "${form.procedure}"`)
    toast('Consent recorded'); onDone()
  }

  return (
    <Modal title={'Mark signed — ' + form.procedure} onClose={onClose}>
      <label>Patient signature</label>
      {signature ? (
        <div>
          <img src={signature} alt="Signature" style={{ maxWidth: '100%', border: '1px solid var(--rule)', borderRadius: 'var(--radius-sm)' }} />
          <button type="button" className="btn ghost sm" style={{ marginTop: '.4rem' }} onClick={() => setSignature(null)}>Redo signature</button>
        </div>
      ) : (
        <SignaturePad onSave={setSignature} />
      )}
      <label style={{ marginTop: '1rem' }}>Document URL (optional — scanned physical copy)</label>
      <input value={documentUrl} onChange={e => setDocumentUrl(e.target.value)} />
      <button className="btn" onClick={save}>Confirm signed today</button>
    </Modal>
  )
}
