import { useEffect, useRef, useState } from 'react'
import { sb } from '../lib/supabase'
import { fmtD, today } from '../lib/format'
import { useToast } from './Toast'
import Modal from './Modal'
import ConfirmDialog from './ConfirmDialog'

const IMAGE_TYPES = ['bitewing', 'periapical', 'panoramic', 'cbct', 'clinical_photo', 'other']
const BUCKET = 'xray-images'
const SIGNED_TTL = 6 * 3600 // 1hr expired too fast for a page left open; re-signed on error below too

export function UploadForm({ patientId, onClose, onDone }) {
  const [staff, setStaff] = useState([])
  const [f, setF] = useState({ tooth_number: '', image_type: 'periapical', taken_date: today(), notes: '', uploaded_by: '' })
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  const set = k => e => setF(x => ({ ...x, [k]: e.target.value }))

  useEffect(() => {
    sb.from('staff').select('*').eq('active', true).order('full_name').then(({ data }) => setStaff(data ?? []))
  }, [])

  async function save() {
    if (!file) return toast('Choose an image file.')
    setBusy(true)
    const path = `${patientId}/${Date.now()}_${file.name}`
    const { error: upErr } = await sb.storage.from(BUCKET).upload(path, file)
    if (upErr) { setBusy(false); return toast('Upload error: ' + upErr.message) }
    const { error } = await sb.from('xray_images').insert({
      patient_id: patientId, tooth_number: parseInt(f.tooth_number) || null, image_type: f.image_type,
      file_url: path, taken_date: f.taken_date || null, notes: f.notes.trim() || null, uploaded_by: f.uploaded_by || null,
    })
    setBusy(false)
    if (error) return toast('Error: ' + error.message)
    toast('X-ray uploaded'); onDone()
  }

  return (
    <Modal title="Upload X-ray" onClose={onClose}>
      <label>Image file *</label><input type="file" accept="image/*" onChange={e => setFile(e.target.files[0])} />
      <div className="mrow">
        <div><label>Image type</label><select value={f.image_type} onChange={set('image_type')}>
          {IMAGE_TYPES.map(t => <option key={t}>{t}</option>)}</select></div>
        <div><label>Tooth number (optional)</label><input type="number" min="1" max="32" value={f.tooth_number} onChange={set('tooth_number')} /></div>
      </div>
      <div className="mrow">
        <div><label>Taken date</label><input type="date" value={f.taken_date} onChange={set('taken_date')} /></div>
        <div><label>Uploaded by</label><select value={f.uploaded_by} onChange={set('uploaded_by')}>
          <option value="">—</option>{staff.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}</select></div>
      </div>
      <label>Notes</label><input value={f.notes} onChange={set('notes')} />
      <button className="btn" disabled={busy} onClick={save}>{busy ? 'Uploading…' : 'Upload'}</button>
    </Modal>
  )
}

export default function XRayPanel({ patientId }) {
  const [rows, setRows] = useState(null)
  const [urls, setUrls] = useState({})
  const [show, setShow] = useState(false)
  const [confirmDel, setConfirmDel] = useState(null)
  const [selected, setSelected] = useState([])
  const [compare, setCompare] = useState(false)
  const toast = useToast()
  const retried = useRef(new Set())

  function toggleSelect(id) {
    setSelected(s => s.includes(id) ? s.filter(x => x !== id) : (s.length >= 2 ? [s[1], id] : [...s, id]))
  }

  async function load() {
    const { data, error } = await sb.from('xray_images').select('*, staff(full_name)').eq('patient_id', patientId)
      .is('deleted_at', null).order('taken_date', { ascending: false })
    if (error) toast('Error: ' + error.message)
    const entries = await Promise.all((data ?? []).map(async x => {
      const { data: signed } = await sb.storage.from(BUCKET).createSignedUrl(x.file_url, SIGNED_TTL)
      return [x.id, signed?.signedUrl]
    }))
    setUrls(Object.fromEntries(entries))
    retried.current = new Set()
    setRows(data ?? [])
  }
  useEffect(() => { load() }, [patientId])

  async function refreshUrl(x) {
    if (retried.current.has(x.id)) return
    retried.current.add(x.id)
    const { data: signed } = await sb.storage.from(BUCKET).createSignedUrl(x.file_url, SIGNED_TTL)
    if (signed?.signedUrl) setUrls(u => ({ ...u, [x.id]: signed.signedUrl }))
  }

  async function remove(x) {
    const { error } = await sb.from('xray_images').update({ deleted_at: new Date().toISOString() }).eq('id', x.id)
    if (error) return toast('Error: ' + error.message)
    toast('Moved to trash', { actionLabel: 'Undo', onAction: async () => { await sb.from('xray_images').update({ deleted_at: null }).eq('id', x.id); load() } })
    load()
  }

  if (!rows) return <div className="empty">Loading…</div>
  return (
    <>
      <button className="btn" style={{ marginBottom: '.75rem' }} onClick={() => setShow(true)}>+ Upload X-ray</button>{' '}
      {selected.length === 2 && <button className="btn ghost" style={{ marginBottom: '.75rem' }} onClick={() => setCompare(true)}>Compare selected</button>}
      {selected.length > 0 && <span style={{ fontSize: '.72rem', color: 'var(--soft)', marginLeft: '.5rem' }}>
        {selected.length === 1 ? 'Pick one more to compare' : '2 selected'}</span>}
      {!rows.length ? <div className="empty">No X-rays uploaded.</div> : (
        <div className="xray-grid">
          {rows.map(x => (
            <div key={x.id} className="xray-card">
              <a href={urls[x.id]} target="_blank" rel="noreferrer">
                <img src={urls[x.id]} alt={x.image_type} loading="lazy"
                  onLoad={e => e.target.classList.add('loaded')} onError={() => refreshUrl(x)} />
              </a>
              <div className="xray-meta">
                <label style={{ display: 'flex', alignItems: 'center', gap: '.4rem', textTransform: 'none', fontSize: '.72rem', color: 'var(--soft)' }}>
                  <input type="checkbox" style={{ width: 'auto' }} checked={selected.includes(x.id)} onChange={() => toggleSelect(x.id)} /> Compare
                </label>
                <b>{x.image_type}</b>{x.tooth_number ? ' · Tooth ' + x.tooth_number : ''}<br />
                {fmtD(x.taken_date)}{x.staff?.full_name ? ' · ' + x.staff.full_name : ''}
                <button className="btn sm ghost danger" onClick={() => setConfirmDel(x)}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
      {show && <UploadForm patientId={patientId} onClose={() => setShow(false)} onDone={() => { setShow(false); load() }} />}
      {confirmDel && <ConfirmDialog title="Move this X-ray to trash?" body="You can restore it later from Trash." confirmLabel="Move to trash"
        onCancel={() => setConfirmDel(null)} onConfirm={() => { remove(confirmDel); setConfirmDel(null) }} />}
      {compare && (
        <CompareModal images={selected.map(id => rows.find(x => x.id === id)).filter(Boolean)} urls={urls}
          onClose={() => setCompare(false)} />
      )}
    </>
  )
}

function CompareModal({ images, urls, onClose }) {
  return (
    <Modal title="Before / after comparison" onClose={onClose} wide>
      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
        {images.map(x => (
          <div key={x.id} style={{ flex: '1 1 260px', minWidth: 220 }}>
            <img src={urls[x.id]} alt={x.image_type} style={{ width: '100%', borderRadius: 8 }} />
            <p style={{ fontSize: '.78rem', color: 'var(--mid)', marginTop: '.4rem' }}>
              {fmtD(x.taken_date)} · {x.image_type}{x.tooth_number ? ' · Tooth ' + x.tooth_number : ''}
            </p>
          </div>
        ))}
      </div>
    </Modal>
  )
}
