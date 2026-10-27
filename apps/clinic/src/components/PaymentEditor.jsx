import { useEffect, useRef, useState } from 'react'
import { sb } from '../lib/supabase'
import { billed, received } from '../lib/handoff'
import { inr, fmtDT } from '../lib/format'
import Modal from './Modal'
import { useToast } from './Toast'

export default function PaymentEditor({ invoice, onDone }) {
  const [open, setOpen] = useState(false)
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState('')
  const [note, setNote] = useState('')
  const [refunded, setRefunded] = useState(false)
  const [history, setHistory] = useState([])
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const toast = useToast()
  useEffect(() => {
    if (!open) return
    setAmount(invoice.amount_paid == null && invoice.payment_status === 'partial' ? '' : String(received(invoice)))
    setMethod(invoice.payment_method || ''); setNote(''); setRefunded(invoice.payment_status === 'refunded')
    sb.from('invoice_payment_changes').select('*').eq('invoice_id', invoice.id).order('created_at', { ascending: false }).limit(50)
      .then(({ data, error }) => { if (error) toast(error.message); else setHistory(data || []) })
  }, [open, invoice])
  async function save() {
    if (lock.current) return
    const value = Number(amount)
    if (!amount.trim() || !Number.isFinite(value) || value < 0 || value > billed(invoice) || !note.trim()) return toast('Enter the net amount received and a payment note.')
    lock.current = true; setBusy(true)
    try {
      const { error } = await sb.rpc('record_invoice_payment', { p_id: invoice.id, p_amount: value, p_refunded: refunded, p_method: method || null, p_note: note.trim(), p_version: invoice.payment_version })
      if (error) throw error
      toast('Payment recorded'); setOpen(false); onDone()
    } catch (e) { toast(e.message) }
    finally { lock.current = false; setBusy(false) }
  }
  return <><span>{invoice.payment_status}</span>{' '}<button className="btn sm ghost" onClick={() => setOpen(true)}>Record payment</button>
    {open && <Modal title="Record payment / correction" onClose={() => !busy && setOpen(false)}>
      <p>Invoice total: {inr(billed(invoice))}</p>
      {invoice.amount_paid == null && invoice.payment_status === 'partial' && <p>Previous partial payment amount is unknown. Reconcile against the old records.</p>}
      <label>Total net received to date (INR)</label><input type="number" min="0" max={billed(invoice)} step="0.01" value={amount} onChange={e => setAmount(e.target.value)} />
      <p>Include earlier payments. For example, ₹4,000 already received plus ₹2,000 today means enter ₹6,000.</p>
      <label>Method for this change</label><select value={method} onChange={e => setMethod(e.target.value)}><option value="">—</option>{['cash', 'card', 'upi', 'insurance', 'mixed'].map(m => <option key={m}>{m}</option>)}</select>
      <label><input type="checkbox" style={{ width: 'auto' }} checked={refunded} onChange={e => { setRefunded(e.target.checked); if (e.target.checked) setAmount('0') }} /> Fully refunded; close invoice balance</label>
      <label>Payment reference / reason *</label><input value={note} onChange={e => setNote(e.target.value)} />
      <button className="btn" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save payment'}</button>
      <p>Recent payment changes</p>{history.map(h => <p key={h.id}>{fmtDT(h.created_at)} · {h.old_amount == null ? 'Unknown' : inr(h.old_amount)} → {inr(h.new_amount)} · {h.note}</p>)}
    </Modal>}
  </>
}
