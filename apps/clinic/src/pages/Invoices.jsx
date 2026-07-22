import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { fmtD, inr } from '../lib/format'
import { useToast } from '../components/Toast'
import StatusSelect from '../components/StatusSelect'

export default function Invoices() {
  const [rows, setRows] = useState(null)
  const toast = useToast()
  const nav = useNavigate()

  async function load() {
    const { data, error } = await sb.from('invoices').select('*, patients(full_name), staff(full_name)')
      .order('invoice_date', { ascending: false }).limit(300)
    if (error) return toast('Error: ' + error.message)
    setRows(data)
  }
  useEffect(() => { load() }, [])

  async function setStatus(id, status) {
    const { error } = await sb.from('invoices').update({ payment_status: status }).eq('id', id)
    if (error) return toast('Error: ' + error.message)
    toast('Invoice ' + status); load()
  }

  if (!rows) return <div className="empty">Loading…</div>
  const pend = rows.filter(r => r.payment_status === 'pending' || r.payment_status === 'partial').reduce((a, r) => a + Number(r.amount), 0)
  const paid = rows.filter(r => r.payment_status === 'paid').reduce((a, r) => a + Number(r.amount), 0)

  return (
    <>
      <div className="pagehead"><h2>Invoices</h2></div>
      <div className="stats">
        <div className="stat green"><b>{inr(paid)}</b><span>Collected</span></div>
        <div className="stat pink"><b>{inr(pend)}</b><span>Outstanding</span></div>
        <div className="stat"><b>{rows.length}</b><span>Invoices</span></div>
        <div />
      </div>
      {!rows.length ? <div className="empty">No invoices yet. Create one from a patient page.</div> : (
        <table className="tbl">
          <thead><tr><th>#</th><th>Date</th><th>Patient</th><th>Amount</th><th>Method</th><th>Doctor</th><th>Status</th><th></th></tr></thead>
          <tbody>{rows.map(v => (
            <tr key={v.id}>
              <td>{v.invoice_number ? String(v.invoice_number).padStart(6, '0') : '—'}</td>
              <td>{fmtD(v.invoice_date)}</td>
              <td className="link" onClick={() => nav('/patients/' + v.patient_id)}>{v.patients?.full_name}</td>
              <td>{inr(v.amount)}{v.tax_amount ? <span style={{ color: 'var(--soft)' }}> +{inr(v.tax_amount)} tax</span> : ''}</td>
              <td>{v.payment_method || '—'}</td>
              <td>{v.staff?.full_name || '—'}</td>
              <td><StatusSelect value={v.payment_status} options={['pending', 'partial', 'paid', 'refunded']} onChange={s => setStatus(v.id, s)} /></td>
              <td><a className="btn sm ghost" target="_blank" rel="noreferrer" href={'/print/invoice/' + v.id}>Print</a></td>
            </tr>
          ))}</tbody>
        </table>
      )}
    </>
  )
}
