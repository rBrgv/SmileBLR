import { useEffect, useState } from 'react'
import { sb } from '../lib/supabase'
import { inr } from '../lib/format'
import { useToast } from '../components/Toast'
import Modal from '../components/Modal'

export default function Treatments() {
  const [rows, setRows] = useState(null)
  const [show, setShow] = useState(false)
  const [f, setF] = useState({ name: '', category: 'Preventive', typical_duration_minutes: 30, price_min: '', price_max: '' })
  const toast = useToast()
  const set = k => e => setF(x => ({ ...x, [k]: e.target.value }))

  async function load() {
    const { data } = await sb.from('treatments').select('*').order('name')
    setRows(data ?? [])
  }
  useEffect(() => { load() }, [])

  async function save() {
    if (!f.name.trim()) return toast('Name required.')
    const { error } = await sb.from('treatments').insert({
      name: f.name.trim(), category: f.category,
      typical_duration_minutes: parseInt(f.typical_duration_minutes) || null,
      price_min: parseFloat(f.price_min) || null, price_max: parseFloat(f.price_max) || null,
    })
    if (error) return toast('Error: ' + error.message)
    toast('Treatment added'); setShow(false); setF({ name: '', category: 'Preventive', typical_duration_minutes: 30, price_min: '', price_max: '' }); load()
  }

  if (!rows) return <div className="empty">Loading…</div>
  return (
    <>
      <div className="pagehead">
        <h2>Treatment catalogue</h2>
        <button className="btn" onClick={() => setShow(true)}>+ Add treatment</button>
      </div>
      {!rows.length ? <div className="empty">Empty catalogue. Add Root Canal, Implant, Cleaning…</div> : (
        <table className="tbl">
          <thead><tr><th>Name</th><th>Category</th><th>Duration</th><th>Price range</th></tr></thead>
          <tbody>{rows.map(t => (
            <tr key={t.id}>
              <td>{t.name}</td><td>{t.category || '—'}</td>
              <td>{t.typical_duration_minutes ? t.typical_duration_minutes + ' min' : '—'}</td>
              <td>{t.price_min ? `${inr(t.price_min)} – ${inr(t.price_max)}` : '—'}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
      {show && (
        <Modal title="Add treatment" onClose={() => setShow(false)}>
          <label>Name *</label><input value={f.name} onChange={set('name')} />
          <div className="mrow">
            <div><label>Category</label><select value={f.category} onChange={set('category')}>
              {['Preventive', 'Restorative', 'Surgical', 'Cosmetic', 'Diagnostic'].map(c => <option key={c}>{c}</option>)}</select></div>
            <div><label>Duration (min)</label><input type="number" value={f.typical_duration_minutes} onChange={set('typical_duration_minutes')} /></div>
          </div>
          <div className="mrow">
            <div><label>Price min</label><input type="number" value={f.price_min} onChange={set('price_min')} /></div>
            <div><label>Price max</label><input type="number" value={f.price_max} onChange={set('price_max')} /></div>
          </div>
          <button className="btn" onClick={save}>Save</button>
        </Modal>
      )}
    </>
  )
}
