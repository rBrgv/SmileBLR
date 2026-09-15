import { useEffect, useState } from 'react'
import { sb } from '../lib/supabase'
import { inr } from '../lib/format'
import { useToast } from '../components/Toast'
import { useRole } from '../lib/RoleContext'
import Modal from '../components/Modal'

const emptyForm = { name: '', category: 'Preventive', typical_duration_minutes: 30, price_min: '', price_max: '' }

export default function Treatments() {
  const [rows, setRows] = useState(null)
  const [show, setShow] = useState(false)
  const [editing, setEditing] = useState(null)
  const [f, setF] = useState(emptyForm)
  const toast = useToast()
  const role = useRole()
  const isAdmin = role === 'admin'
  const set = k => e => setF(x => ({ ...x, [k]: e.target.value }))

  async function load() {
    const { data } = await sb.from('treatments').select('*').order('name')
    setRows(data ?? [])
  }
  useEffect(() => { load() }, [])

  function openAdd() { setEditing(null); setF(emptyForm); setShow(true) }
  function openEdit(t) {
    setEditing(t)
    setF({ name: t.name, category: t.category || 'Preventive', typical_duration_minutes: t.typical_duration_minutes ?? 30, price_min: t.price_min ?? '', price_max: t.price_max ?? '' })
    setShow(true)
  }

  async function save() {
    if (!f.name.trim()) return toast('Name required.')
    const payload = {
      name: f.name.trim(), category: f.category,
      typical_duration_minutes: parseInt(f.typical_duration_minutes) || null,
      price_min: parseFloat(f.price_min) || null, price_max: parseFloat(f.price_max) || null,
    }
    const { error } = editing
      ? await sb.from('treatments').update(payload).eq('id', editing.id)
      : await sb.from('treatments').insert(payload)
    if (error) return toast('Error: ' + error.message)
    toast(editing ? 'Treatment updated' : 'Treatment added'); setShow(false); setEditing(null); setF(emptyForm); load()
  }

  async function remove(t) {
    if (!confirm(`Delete "${t.name}" from the catalogue?`)) return
    const { error } = await sb.from('treatments').delete().eq('id', t.id)
    if (error) return toast('Error: ' + error.message)
    toast('Treatment deleted'); load()
  }

  if (!rows) return <div className="empty">Loading…</div>
  return (
    <>
      <div className="pagehead">
        <h2>Treatment catalogue</h2>
        <button className="btn" onClick={openAdd}>+ Add treatment</button>
      </div>
      {!rows.length ? <div className="empty">Empty catalogue. Add Root Canal, Implant, Cleaning…</div> : (
        <table className="tbl">
          <thead><tr><th>Name</th><th>Category</th><th>Duration</th><th>Price range</th><th></th></tr></thead>
          <tbody>{rows.map(t => (
            <tr key={t.id}>
              <td>{t.name}</td><td>{t.category || '—'}</td>
              <td>{t.typical_duration_minutes ? t.typical_duration_minutes + ' min' : '—'}</td>
              <td>{t.price_min ? `${inr(t.price_min)} – ${inr(t.price_max)}` : '—'}</td>
              <td>
                <button className="btn sm ghost" onClick={() => openEdit(t)}>Edit</button>{' '}
                {isAdmin && <button className="btn sm ghost" onClick={() => remove(t)}>Delete</button>}
              </td>
            </tr>
          ))}</tbody>
        </table>
      )}
      {show && (
        <Modal title={editing ? 'Edit treatment' : 'Add treatment'} onClose={() => setShow(false)}>
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
