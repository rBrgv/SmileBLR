import { useEffect, useState } from 'react'
import { sb } from '../lib/supabase'
import { fmtD, today } from '../lib/format'
import { useToast } from './Toast'
import Modal from './Modal'
import ConfirmDialog from './ConfirmDialog'

const DOC_TYPES = [
  ['referral_letter', 'Referral Letter'], ['prior_records', 'Prior Records'],
  ['id_proof', 'ID Proof'], ['lab_report', 'Lab Report'], ['other', 'Other'],
]
const DOC_LABELS = Object.fromEntries(DOC_TYPES)
const BUCKET = 'xray-images' // reuses the existing bucket + storage policies under a docs/ prefix
const SIGNED_TTL = 6 * 3600

function UploadForm({ patientId, onClose, onDone }) {
  const [staff, setStaff] = useState([])
  const [f, setF] = useState({ doc_type: 'other', uploaded_date: today(), notes: '', uploaded_by: '' })
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  const set = k => e => setF(x => ({ ...x, [k]: e.target.value }))

  useEffect(() => {
    sb.from('staff').select('*').eq('active', true).order('full_name').then(({ data }) => setStaff(data ?? []))
  }, [])

  async function save() {
    if (!file) return toast('Choose a file.')
    setBusy(true)
    const path = `${patientId}/docs/${Date.now()}_${file.name}`
    const { error: upErr } = await sb.storage.from(BUCKET).upload(path, file)
    if (upErr) { setBusy(false); return toast('Upload error: ' + upErr.message) }
    const { error } = await sb.from('patient_documents').insert({
      patient_id: patientId, doc_type: f.doc_type, file_url: path, file_name: file.name,
      uploaded_date: f.uploaded_date || null, notes: f.notes.trim() || null, uploaded_by: f.uploaded_by || null,
    })
    setBusy(false)
    if (error) return toast('Error: ' + error.message)
    toast('Document uploaded'); onDone()
  }

  return (
    <Modal title="Upload document" onClose={onClose}>
      <label>File *</label><input type="file" onChange={e => setFile(e.target.files[0])} />
      <div className="mrow">
        <div><label>Type</label><select value={f.doc_type} onChange={set('doc_type')}>
          {DOC_TYPES.map(([v, label]) => <option key={v} value={v}>{label}</option>)}</select></div>
        <div><label>Date</label><input type="date" value={f.uploaded_date} onChange={set('uploaded_date')} /></div>
      </div>
      <label>Uploaded by</label>
      <select value={f.uploaded_by} onChange={set('uploaded_by')}>
        <option value="">—</option>{staff.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
      </select>
      <label>Notes</label><input value={f.notes} onChange={set('notes')} />
      <button className="btn" disabled={busy} onClick={save}>{busy ? 'Uploading…' : 'Upload'}</button>
    </Modal>
  )
}

export default function PatientDocumentsPanel({ patientId }) {
  const [rows, setRows] = useState(null)
  const [show, setShow] = useState(false)
  const [confirmDel, setConfirmDel] = useState(null)
  const toast = useToast()

  async function load() {
    const { data, error } = await sb.from('patient_documents').select('*, staff(full_name)')
      .eq('patient_id', patientId).is('deleted_at', null).order('uploaded_date', { ascending: false })
    if (error) { toast('Error: ' + error.message); return setRows([]) }
    setRows(data)
  }
  useEffect(() => { load() }, [patientId])

  async function open(doc) {
    const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(doc.file_url, SIGNED_TTL)
    if (error || !data?.signedUrl) return toast('Could not open file: ' + (error?.message || 'unknown error'))
    window.open(data.signedUrl, '_blank')
  }

  async function remove(doc) {
    const { error } = await sb.from('patient_documents').update({ deleted_at: new Date().toISOString() }).eq('id', doc.id)
    if (error) return toast('Error: ' + error.message)
    toast('Moved to trash', { actionLabel: 'Undo', onAction: async () => { await sb.from('patient_documents').update({ deleted_at: null }).eq('id', doc.id); load() } })
    load()
  }

  if (!rows) return <div className="empty">Loading…</div>
  return (
    <>
      <button className="btn" style={{ marginBottom: '.75rem' }} onClick={() => setShow(true)}>+ Upload document</button>
      {!rows.length ? <div className="empty">No documents uploaded.</div> : (
        <table className="tbl">
          <thead><tr><th>Type</th><th>File</th><th>Date</th><th>Uploaded by</th><th>Notes</th><th></th></tr></thead>
          <tbody>{rows.map(doc => (
            <tr key={doc.id}>
              <td>{DOC_LABELS[doc.doc_type] || doc.doc_type}</td>
              <td className="link" onClick={() => open(doc)}>{doc.file_name || 'View'}</td>
              <td>{fmtD(doc.uploaded_date)}</td>
              <td>{doc.staff?.full_name || '—'}</td>
              <td>{doc.notes || '—'}</td>
              <td><button className="btn sm ghost danger" onClick={() => setConfirmDel(doc)}>Delete</button></td>
            </tr>
          ))}</tbody>
        </table>
      )}
      {show && <UploadForm patientId={patientId} onClose={() => setShow(false)} onDone={() => { setShow(false); load() }} />}
      {confirmDel && <ConfirmDialog title="Move this document to trash?" body="You can restore it later from Trash." confirmLabel="Move to trash"
        onCancel={() => setConfirmDel(null)} onConfirm={() => { remove(confirmDel); setConfirmDel(null) }} />}
    </>
  )
}
