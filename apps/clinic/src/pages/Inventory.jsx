import { useEffect, useState } from 'react'
import { sb } from '../lib/supabase'
import { today } from '../lib/format'
import { useToast } from '../components/Toast'
import Modal from '../components/Modal'

export default function Inventory() {
  const [rows, setRows] = useState(null)
  const [modal, setModal] = useState(null) // 'add' | {adjust}
  const toast = useToast()

  async function load() {
    const { data } = await sb.from('inventory').select('*').order('item_name')
    setRows(data ?? [])
  }
  useEffect(() => { load() }, [])

  if (!rows) return <div className="empty">Loading…</div>
  return (
    <>
      <div className="pagehead">
        <h2>Inventory</h2>
        <button className="btn" onClick={() => setModal('add')}>+ Add item</button>
      </div>
      {!rows.length ? <div className="empty">No items tracked yet.</div> : (
        <table className="tbl">
          <thead><tr><th>Item</th><th>Category</th><th>Stock</th><th>Reorder at</th><th>Supplier</th><th></th></tr></thead>
          <tbody>{rows.map(x => {
            const low = x.reorder_threshold != null && Number(x.current_stock) <= Number(x.reorder_threshold)
            return (
              <tr key={x.id}>
                <td>{x.item_name}{low && <> <span className="badge b-new">LOW</span></>}</td>
                <td>{x.category || '—'}</td>
                <td className={low ? 'low' : ''}>{x.current_stock} {x.unit || ''}</td>
                <td>{x.reorder_threshold ?? '—'}</td>
                <td>{x.supplier || '—'}</td>
                <td><button className="btn sm ghost" onClick={() => setModal({ adjust: x })}>Adjust</button></td>
              </tr>
            )
          })}</tbody>
        </table>
      )}
      {modal === 'add' && <AddItem onClose={() => setModal(null)} onDone={() => { setModal(null); load() }} />}
      {modal?.adjust && <Adjust item={modal.adjust} onClose={() => setModal(null)} onDone={() => { setModal(null); load() }} />}
    </>
  )
}

function AddItem({ onClose, onDone }) {
  const [f, setF] = useState({ item_name: '', category: 'Consumables', unit: '', current_stock: 0, reorder_threshold: '', supplier: '' })
  const toast = useToast()
  const set = k => e => setF(x => ({ ...x, [k]: e.target.value }))
  async function save() {
    if (!f.item_name.trim()) return toast('Item name required.')
    const { error } = await sb.from('inventory').insert({
      item_name: f.item_name.trim(), category: f.category, unit: f.unit.trim() || null,
      current_stock: parseFloat(f.current_stock) || 0, reorder_threshold: parseFloat(f.reorder_threshold) || null,
      supplier: f.supplier.trim() || null, last_restocked: today(),
    })
    if (error) return toast('Error: ' + error.message)
    toast('Item added'); onDone()
  }
  return (
    <Modal title="Add inventory item" onClose={onClose}>
      <label>Item name *</label><input placeholder="Latex gloves (M)" value={f.item_name} onChange={set('item_name')} />
      <div className="mrow">
        <div><label>Category</label><select value={f.category} onChange={set('category')}>
          {['Consumables', 'Medication', 'Equipment', 'Implant kits'].map(c => <option key={c}>{c}</option>)}</select></div>
        <div><label>Unit</label><input placeholder="boxes / vials" value={f.unit} onChange={set('unit')} /></div>
      </div>
      <div className="mrow">
        <div><label>Current stock</label><input type="number" value={f.current_stock} onChange={set('current_stock')} /></div>
        <div><label>Reorder threshold</label><input type="number" value={f.reorder_threshold} onChange={set('reorder_threshold')} /></div>
      </div>
      <label>Supplier</label><input value={f.supplier} onChange={set('supplier')} />
      <button className="btn" onClick={save}>Save item</button>
    </Modal>
  )
}

function Adjust({ item, onClose, onDone }) {
  const [v, setV] = useState(item.current_stock)
  const toast = useToast()
  async function save() {
    const { error } = await sb.from('inventory').update({ current_stock: parseFloat(v) || 0, last_restocked: today() }).eq('id', item.id)
    if (error) return toast('Error: ' + error.message)
    toast('Stock updated'); onDone()
  }
  return (
    <Modal title={'Adjust stock — ' + item.item_name} onClose={onClose}>
      <label>New stock level</label><input type="number" value={v} onChange={e => setV(e.target.value)} />
      <button className="btn" onClick={save}>Update</button>
    </Modal>
  )
}
