import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { fetchAll, billed, received, balance, credit } from '../lib/handoff'
import { fmtD, inr } from '../lib/format'
import { ageLabel } from '../lib/age'
import { statusLabel } from '../lib/status'
import { toothLabel } from '../lib/teeth'
import { invoiceNo } from '../lib/bills'
import { rupeesInWords } from '../lib/words'
import { recordTotal, recordTotals } from '../lib/records'
import PrintDoc from '../components/PrintDoc'

// Everything done for this patient, on one sheet: what was treated, what is
// still planned, and where the money stands. The page patients ask for when
// they want "the whole file", and the one a referring dentist wants.
export default function PrintTreatmentSummary() {
  const { id } = useParams()
  const [d, setD] = useState(null)

  useEffect(() => {
    Promise.all([
      sb.from('patients').select('*').eq('id', id).single(),
      fetchAll(() => sb.from('treatment_records').select('*, treatments(name), staff(full_name)').eq('patient_id', id).is('deleted_at', null).order('performed_date', { ascending: false }).order('id')),
      fetchAll(() => sb.from('treatment_plans').select('*, treatment_plan_stages(*)').eq('patient_id', id).is('deleted_at', null).order('created_at', { ascending: false }).order('id')),
      fetchAll(() => sb.from('invoices').select('*').eq('patient_id', id).order('invoice_date').order('id')),
    ]).then(([p, records, plans, invoices]) => setD({ p: p.data, records, plans, invoices }))
  }, [id])

  if (!d?.p) return <div className="empty">Loading…</div>
  const { p, records, plans, invoices } = d
  const age = ageLabel(p)
  const totals = invoices.reduce((a, v) => ({
    billed: a.billed + billed(v), paid: a.paid + received(v),
    due: a.due + balance(v), over: a.over + credit(v),
  }), { billed: 0, paid: 0, due: 0, over: 0 })

  return (
    <PrintDoc title="Treatment summary">
      <div className="print-row"><b>Patient</b><span>{p.full_name} · {p.patient_code}{p.manual_id ? ' · file ' + p.manual_id : ''}</span></div>
      <div className="print-row"><b>Age / gender</b><span>{[age ? age + ' yrs' : null, p.gender].filter(Boolean).join(' · ') || '—'}</span></div>
      <div className="print-row"><b>Phone</b><span>{p.phone || '—'}</span></div>
      <div className="print-row"><b>Patient since</b><span>{fmtD(p.created_at)}</span></div>

      <div className="print-block">
        <h4>Treatment carried out · {records.length} {records.length === 1 ? 'record' : 'records'}</h4>
        {records.length ? (
          <table className="tbl">
            <thead><tr><th>Date</th><th>Tooth</th><th>Treatment</th><th>By</th><th>Units</th><th>Cost</th><th>Discount</th><th>Total</th><th>Status</th></tr></thead>
            <tbody>{records.map(r => (
              <tr key={r.id}>
                <td>{fmtD(r.performed_date)}</td>
                <td>{r.tooth_number ? toothLabel(r.tooth_number) : '—'}</td>
                <td>{r.treatments?.name || '—'}</td>
                <td>{r.staff?.full_name || '—'}</td>
                <td>{r.units ?? 1}</td>
                <td>{r.amount == null ? '—' : inr(r.amount)}</td>
                <td>{Number(r.discount) > 0 ? inr(r.discount) : '—'}</td>
                <td>{r.amount == null ? '—' : inr(recordTotal(r))}</td>
                <td>{statusLabel(r.status ?? 'completed')}</td>
              </tr>
            ))}</tbody>
          </table>
        ) : <p>No treatment recorded.</p>}
        {records.length > 0 && (() => {
          const t = recordTotals(records)
          return (
            <p style={{ textAlign: 'right', marginTop: '.5rem' }}>
              Total cost {inr(t.cost)} · Discount {inr(t.discount)} · <b>Grand total {inr(t.grand)}</b>
              {t.missing ? ` (${t.missing} without a cost)` : ''}
            </p>
          )
        })()}
      </div>

      <div className="print-block">
        <h4>Plans</h4>
        {plans.length ? plans.map(pl => (
          <p key={pl.id}>
            <b>{pl.plan_description || 'Plan'}</b> · {statusLabel(pl.status)} · estimate {inr(pl.total_estimated_cost)}
            {[...(pl.treatment_plan_stages || [])].sort((a, b) => a.stage_number - b.stage_number).map(s => (
              <span key={s.id}><br />&nbsp;&nbsp;{s.stage_number}. {s.description || 'Stage'} — {statusLabel(s.status)}{s.estimated_cost ? ' · ' + inr(s.estimated_cost) : ''}</span>
            ))}
          </p>
        )) : <p>No treatment plan recorded.</p>}
      </div>

      <div className="print-block">
        <h4>Billing</h4>
        {invoices.length ? (
          <table className="tbl">
            <thead><tr><th>Invoice</th><th>Date</th><th>Total</th><th>Received</th><th>Status</th><th>Balance</th></tr></thead>
            <tbody>{invoices.map(v => (
              <tr key={v.id}>
                <td>{invoiceNo(v)}</td><td>{fmtD(v.invoice_date)}</td><td>{inr(billed(v))}</td>
                <td>{inr(received(v))}</td><td>{statusLabel(v.payment_status)}</td>
                <td>{credit(v) > 0 ? 'credit ' + inr(credit(v)) : inr(balance(v))}</td>
              </tr>
            ))}</tbody>
          </table>
        ) : <p>Nothing billed.</p>}
      </div>

      <div className="print-row"><b>Total billed</b><span>{inr(totals.billed)}</span></div>
      <div className="print-row"><b>Total received</b><span>{inr(totals.paid)}</span></div>
      <div className="print-row">
        <b>{totals.over > 0 && !totals.due ? 'Refund due to patient' : 'Balance due'}</b>
        <span>{inr(totals.over > 0 && !totals.due ? totals.over : totals.due)}</span>
      </div>
      {totals.due > 0 && <div className="print-block"><h4>Balance in words</h4><p>{rupeesInWords(totals.due)}</p></div>}
      <div className="print-signature">
        <div>Doctor</div>
        <div>Prepared on {fmtD(new Date())}</div>
      </div>
    </PrintDoc>
  )
}
