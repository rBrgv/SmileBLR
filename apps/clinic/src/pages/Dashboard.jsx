import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { fmtT, fmtD, digits, inr, today } from '../lib/format'
import { useToast } from '../components/Toast'
import StatusSelect from '../components/StatusSelect'
import CancelReasonDialog from '../components/CancelReasonDialog'
import { RevenueChart, LeadSourceChart } from '../components/Charts'
import { completeAppointment, APPT_STATUSES } from './Appointments'

const LEAD_LABELS = { website: 'Website', whatsapp_direct: 'WhatsApp', referral: 'Referral', walkin: 'Walk-in' }

export default function Dashboard() {
  const [stats, setStats] = useState(null)
  const [todays, setTodays] = useState([])
  const [revenue, setRevenue] = useState([])
  const [leadSources, setLeadSources] = useState([])
  const [lowStock, setLowStock] = useState([])
  const [pendingClaims, setPendingClaims] = useState([])
  const [followUps, setFollowUps] = useState([])
  const [byDoctor, setByDoctor] = useState([])
  const [reasonPrompt, setReasonPrompt] = useState(null)
  const toast = useToast()
  const nav = useNavigate()

  async function load() {
    const from = new Date(); from.setHours(0, 0, 0, 0)
    const to = new Date(from); to.setDate(to.getDate() + 1)
    const sixMonthsAgo = new Date(); sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5); sixMonthsAgo.setDate(1)
    const cutoff = sixMonthsAgo.getFullYear() + '-' + String(sixMonthsAgo.getMonth() + 1).padStart(2, '0') + '-01'
    const monthStart = new Date(); monthStart.setDate(1)
    const monthCutoff = monthStart.toISOString().slice(0, 10)
    const [nb, pt, ap, due, inv, bk, stock, claims, calls, monthInv] = await Promise.all([
      sb.from('bookings').select('id', { count: 'exact', head: true }).eq('status', 'new'),
      sb.from('patients').select('id', { count: 'exact', head: true }),
      sb.from('appointments').select('*, patients(full_name), staff(full_name), treatments(name)')
        .gte('appointment_time', from.toISOString()).lt('appointment_time', to.toISOString())
        .order('appointment_time'),
      sb.from('recall_reminders').select('id', { count: 'exact', head: true })
        .lte('recall_due_date', today()).eq('reminder_sent', false),
      sb.from('invoices').select('amount, invoice_date').eq('payment_status', 'paid').gte('invoice_date', cutoff),
      sb.from('bookings').select('lead_source'),
      sb.from('inventory').select('item_name, current_stock, reorder_threshold, unit').not('reorder_threshold', 'is', null),
      sb.from('insurance_claims').select('id, insurer_name, patients(full_name)').is('deleted_at', null).in('status', ['submitted', 'under_review']),
      sb.from('treatment_records').select('id, patient_id, follow_up_date, treatments(name), patients(full_name,phone)')
        .eq('follow_up_required', true).lte('follow_up_date', today()).is('deleted_at', null).order('follow_up_date'),
      sb.from('invoices').select('amount, doctor_id, staff(full_name)').eq('payment_status', 'paid').gte('invoice_date', monthCutoff),
    ])
    if (inv.error) toast('Revenue chart error: ' + inv.error.message)
    if (bk.error) toast('Lead source chart error: ' + bk.error.message)
    setStats({ nb: nb.count ?? 0, pt: pt.count ?? 0, due: due.count ?? 0 })
    setTodays(ap.data ?? [])
    setLowStock((stock.data ?? []).filter(x => Number(x.current_stock) <= Number(x.reorder_threshold)))
    setPendingClaims(claims.data ?? [])
    setFollowUps(calls.data ?? [])

    const perDoctor = {}
    ;(monthInv.data ?? []).forEach(v => {
      const key = v.doctor_id || 'unattributed'
      perDoctor[key] ||= { name: v.staff?.full_name || 'Not attributed', amount: 0, count: 0 }
      perDoctor[key].amount += Number(v.amount); perDoctor[key].count++
    })
    setByDoctor(Object.values(perDoctor).sort((a, b) => b.amount - a.amount))

    // Key months as plain 'YYYY-MM' strings sliced straight from invoice_date —
    // parsing it through `new Date()` first round-trips through UTC and can
    // roll dates near month boundaries into the wrong local month.
    const months = Array.from({ length: 6 }, (_, i) => {
      const d = new Date(sixMonthsAgo); d.setMonth(d.getMonth() + i)
      return { key: d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'), month: d.toLocaleDateString('en-IN', { month: 'short' }), amount: 0 }
    })
    ;(inv.data ?? []).forEach(v => {
      const key = v.invoice_date.slice(0, 7)
      const m = months.find(x => x.key === key)
      if (m) m.amount += Number(v.amount)
    })
    setRevenue(months)

    const counts = {}
    ;(bk.data ?? []).forEach(b => { counts[b.lead_source] = (counts[b.lead_source] || 0) + 1 })
    setLeadSources(Object.keys(LEAD_LABELS).map(k => ({ source: k, label: LEAD_LABELS[k], count: counts[k] || 0 })))
  }
  useEffect(() => { load() }, [])

  async function setStatus(a, status, reason = null) {
    const rec = { status }
    if (reason !== null) rec.status_reason = reason
    const { error } = await sb.from('appointments').update(rec).eq('id', a.id)
    if (error) return toast('Error: ' + error.message)
    if (status === 'completed') { await completeAppointment(a.patient_id); toast('Visit completed · recall scheduled') }
    else toast('Appointment ' + status.replace('_', ' '))
    load()
  }

  function onStatusChange(a, status) {
    if (status === 'cancelled' || status === 'no_show') setReasonPrompt({ a, status })
    else setStatus(a, status)
  }

  async function markCalled(id) {
    await sb.from('treatment_records').update({ follow_up_required: false }).eq('id', id)
    setFollowUps(f => f.filter(x => x.id !== id))
  }

  if (!stats) return <div className="empty">Loading…</div>
  return (
    <>
      <div className="pagehead">
        <h2>Dashboard</h2>
        <div>{new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
      </div>
      <div className="stats">
        <div className="stat pink"><b>{stats.nb}</b><span>New bookings</span></div>
        <div className="stat"><b>{todays.length}</b><span>Appointments today</span></div>
        <div className="stat green"><b>{stats.pt}</b><span>Patients</span></div>
        <div className="stat gold"><b>{stats.due}</b><span>Recalls due</span></div>
      </div>

      {(lowStock.length > 0 || pendingClaims.length > 0 || followUps.length > 0) && (
        <div className="attention">
          <h2 style={{ fontSize: '.85rem', fontWeight: 500, marginBottom: '.75rem' }}>Needs attention</h2>
          <div className="attention-grid">
            {followUps.length > 0 && (
              <div className="attention-card" style={{ cursor: 'default' }}>
                <b>{followUps.length}</b> follow-up call{followUps.length === 1 ? '' : 's'} due
                <div className="attention-list">
                  {followUps.slice(0, 5).map(f => (
                    <div key={f.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '.5rem', marginBottom: '.3rem' }}>
                      <span className="link" onClick={() => nav('/patients/' + f.patient_id)}>
                        {f.patients?.full_name}{f.treatments?.name ? ' — ' + f.treatments.name : ''} ({fmtD(f.follow_up_date)})
                      </span>
                      <span style={{ whiteSpace: 'nowrap' }}>
                        <a className="btn sm ghost" href={'tel:' + digits(f.patients?.phone)}>Call</a>{' '}
                        <button className="btn sm ghost" onClick={() => markCalled(f.id)}>Called</button>
                      </span>
                    </div>
                  ))}
                  {followUps.length > 5 && <div>+{followUps.length - 5} more…</div>}
                </div>
              </div>
            )}
            {lowStock.length > 0 && (
              <div className="attention-card" onClick={() => nav('/inventory')}>
                <b>{lowStock.length}</b> item{lowStock.length === 1 ? '' : 's'} low on stock
                <div className="attention-list">
                  {lowStock.slice(0, 4).map(x => (
                    <div key={x.item_name}>{x.item_name} — {x.current_stock} {x.unit || ''} left</div>
                  ))}
                  {lowStock.length > 4 && <div>+{lowStock.length - 4} more…</div>}
                </div>
              </div>
            )}
            {pendingClaims.length > 0 && (
              <div className="attention-card" onClick={() => nav('/insurance-claims')}>
                <b>{pendingClaims.length}</b> insurance claim{pendingClaims.length === 1 ? '' : 's'} awaiting resolution
                <div className="attention-list">
                  {pendingClaims.slice(0, 4).map(c => (
                    <div key={c.id}>{c.patients?.full_name} — {c.insurer_name || 'insurer not set'}</div>
                  ))}
                  {pendingClaims.length > 4 && <div>+{pendingClaims.length - 4} more…</div>}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="chart-grid">
        <div className="chart-card">
          <h2 style={{ fontSize: '.85rem', fontWeight: 500, marginBottom: '.75rem' }}>Revenue — last 6 months</h2>
          <RevenueChart data={revenue} />
        </div>
        <div className="chart-card">
          <h2 style={{ fontSize: '.85rem', fontWeight: 500, marginBottom: '.75rem' }}>Bookings by lead source</h2>
          <LeadSourceChart data={leadSources} />
        </div>
        <div className="chart-card chart-card-wide">
          <h2 style={{ fontSize: '.85rem', fontWeight: 500, marginBottom: '.75rem' }}>Revenue by doctor — this month</h2>
          {!byDoctor.length ? <p style={{ fontSize: '.78rem', color: 'var(--soft)' }}>No paid invoices yet this month.</p> : (
            <table className="tbl" style={{ boxShadow: 'none' }}>
              <thead><tr><th>Doctor</th><th>Invoices</th><th>Collected</th></tr></thead>
              <tbody>{byDoctor.map((d, i) => (
                <tr key={i}><td>{d.name}</td><td>{d.count}</td><td>{inr(d.amount)}</td></tr>
              ))}</tbody>
            </table>
          )}
        </div>
      </div>

      <h2 style={{ fontSize: '.95rem', fontWeight: 500, marginBottom: '.75rem' }}>Today's appointments</h2>
      {!todays.length ? <div className="empty">No appointments scheduled for today.</div> : (
        <table className="tbl">
          <thead><tr><th>Time</th><th>Patient</th><th>Doctor</th><th>Treatment</th><th>Room</th><th>Status</th></tr></thead>
          <tbody>{todays.map(a => (
            <tr key={a.id}>
              <td>{fmtT(a.appointment_time)}</td>
              <td className="link" onClick={() => nav('/patients/' + a.patient_id)}>{a.patients?.full_name}</td>
              <td>{a.staff?.full_name || '—'}</td>
              <td>{a.treatments?.name || '—'}</td>
              <td>{a.floor_room || '—'}</td>
              <td>
                <StatusSelect value={a.status} options={APPT_STATUSES} onChange={s => {
                  if (s === 'cancelled' || s === 'no_show') setReasonPrompt({ a, status: s }); else setStatus(a, s)
                }} />
                {a.status_reason && <div style={{ fontSize: '.66rem', color: 'var(--soft)', marginTop: '.2rem' }}>{a.status_reason}</div>}
              </td>
            </tr>
          ))}</tbody>
        </table>
      )}
      {reasonPrompt && (
        <CancelReasonDialog status={reasonPrompt.status} onCancel={() => setReasonPrompt(null)}
          onConfirm={reason => { setStatus(reasonPrompt.a, reasonPrompt.status, reason); setReasonPrompt(null) }} />
      )}
    </>
  )
}
