import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { fmtD } from '../lib/format'
import { useToast } from '../components/Toast'
import ConfirmDialog from '../components/ConfirmDialog'
import Modal from '../components/Modal'

const BUCKET = 'xray-images'
const SIGNED_TTL = 6 * 3600

export default function XRays() {
  const [rows, setRows] = useState(null)
  const [urls, setUrls] = useState({})
  const [q, setQ] = useState('')
  const [confirmDel, setConfirmDel] = useState(null)
  const [selected, setSelected] = useState([])
  const [compare, setCompare] = useState(false)
  const toast = useToast()
  const nav = useNavigate()
  const retried = useRef(new Set())

  function toggleSelect(id) {
    setSelected(s => s.includes(id) ? s.filter(x => x !== id) : (s.length >= 2 ? [s[1], id] : [...s, id]))
  }

  async function load() {
    const { data, error } = await sb.from('xray_images').select('*, patients(id,full_name)')
      .is('deleted_at', null).order('taken_date', { ascending: false }).limit(300)
    if (error) toast('Error: ' + error.message)
    const entries = await Promise.all((data ?? []).map(async x => {
      const { data: signed } = await sb.storage.from(BUCKET).createSignedUrl(x.file_url, SIGNED_TTL)
      return [x.id, signed?.signedUrl]
    }))
    setUrls(Object.fromEntries(entries))
    retried.current = new Set()
    setRows(data ?? [])
  }
  useEffect(() => { load() }, [])

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
  const view = rows.filter(x => !q || (x.patients?.full_name || '').toLowerCase().includes(q.toLowerCase()))

  return (
    <>
      <div className="pagehead"><h2>X-Rays</h2></div>
      <div className="bar">
        <input placeholder="Search patient…" value={q} onChange={e => setQ(e.target.value)} />
        {selected.length === 2 && <button className="btn ghost" style={{ width: 'auto' }} onClick={() => setCompare(true)}>Compare selected</button>}
      </div>
      {!view.length ? <div className="empty">No X-rays yet. Upload from a patient's page.</div> : (
        <div className="xray-grid">
          {view.map(x => (
            <div key={x.id} className="xray-card">
              <a href={urls[x.id]} target="_blank" rel="noreferrer">
                <img src={urls[x.id]} alt={x.image_type} loading="lazy"
                  onLoad={e => e.target.classList.add('loaded')} onError={() => refreshUrl(x)} />
              </a>
              <div className="xray-meta">
                <label style={{ display: 'flex', alignItems: 'center', gap: '.4rem', textTransform: 'none', fontSize: '.72rem', color: 'var(--soft)' }}>
                  <input type="checkbox" style={{ width: 'auto' }} checked={selected.includes(x.id)} onChange={() => toggleSelect(x.id)} /> Compare
                </label>
                <b className="link" onClick={() => nav('/patients/' + x.patients?.id)}>{x.patients?.full_name}</b><br />
                {x.image_type}{x.tooth_number ? ' · Tooth ' + x.tooth_number : ''} · {fmtD(x.taken_date)}
                <button className="btn sm ghost danger" onClick={() => setConfirmDel(x)}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
      {confirmDel && <ConfirmDialog title="Move this X-ray to trash?" body="You can restore it later from Trash." confirmLabel="Move to trash"
        onCancel={() => setConfirmDel(null)} onConfirm={() => { remove(confirmDel); setConfirmDel(null) }} />}
      {compare && (
        <Modal title="Before / after comparison" onClose={() => setCompare(false)} wide>
          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
            {selected.map(id => rows.find(x => x.id === id)).filter(Boolean).map(x => (
              <div key={x.id} style={{ flex: '1 1 260px', minWidth: 220 }}>
                <img src={urls[x.id]} alt={x.image_type} style={{ width: '100%', borderRadius: 8 }} />
                <p style={{ fontSize: '.78rem', color: 'var(--mid)', marginTop: '.4rem' }}>
                  {x.patients?.full_name} · {fmtD(x.taken_date)} · {x.image_type}{x.tooth_number ? ' · Tooth ' + x.tooth_number : ''}
                </p>
              </div>
            ))}
          </div>
        </Modal>
      )}
    </>
  )
}
