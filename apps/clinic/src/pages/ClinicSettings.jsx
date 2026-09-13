import { useEffect, useState } from 'react'
import { sb } from '../lib/supabase'
import { useToast } from '../components/Toast'
import { useRole } from '../lib/RoleContext'
import { logActivity } from '../lib/activityLog'

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export default function ClinicSettings() {
  const [plan, setPlan] = useState(null)
  const [bot, setBot] = useState(null)
  const toast = useToast()
  const role = useRole()
  const isAdmin = role === 'admin'

  async function load() {
    const { data } = await sb.from('clinic_settings').select('*').eq('id', 1).maybeSingle()
    setPlan(data?.plan ?? 'free')
    setBot({
      booking_bot_enabled: data?.booking_bot_enabled ?? false,
      escalation_phone: data?.escalation_phone ?? '',
      open_days: data?.open_days ?? [0, 1, 2, 3, 4, 5, 6],
      open_time: (data?.open_time ?? '10:00').slice(0, 5),
      close_time: (data?.close_time ?? '20:00').slice(0, 5),
      slot_interval_minutes: data?.slot_interval_minutes ?? 30,
    })
  }
  useEffect(() => { load() }, [])

  async function setPlanTo(next) {
    const { error } = await sb.from('clinic_settings').update({ plan: next, updated_at: new Date().toISOString() }).eq('id', 1)
    if (error) return toast('Error: ' + error.message)
    logActivity('clinic_settings.plan_changed', 'clinic_settings', null, `Plan changed to ${next}`)
    toast('Plan updated'); setPlan(next)
  }

  function toggleDay(d) {
    setBot(b => ({ ...b, open_days: b.open_days.includes(d) ? b.open_days.filter(x => x !== d) : [...b.open_days, d].sort() }))
  }

  async function saveBot() {
    const { error } = await sb.from('clinic_settings').update({
      booking_bot_enabled: bot.booking_bot_enabled,
      escalation_phone: bot.escalation_phone.trim() || null,
      open_days: bot.open_days,
      open_time: bot.open_time,
      close_time: bot.close_time,
      slot_interval_minutes: parseInt(bot.slot_interval_minutes) || 30,
      updated_at: new Date().toISOString(),
    }).eq('id', 1)
    if (error) return toast('Error: ' + error.message)
    logActivity('clinic_settings.booking_bot_updated', 'clinic_settings', null, `Booking bot ${bot.booking_bot_enabled ? 'enabled' : 'disabled'}`)
    toast('Booking bot settings saved')
  }

  if (!isAdmin) return <div className="empty">Only admins can change clinic settings.</div>
  if (plan === null || !bot) return <div className="empty">Loading…</div>

  return (
    <>
      <div className="pagehead"><h2>Clinic settings</h2></div>
      <p style={{ fontSize: '.74rem', color: 'var(--mid)', marginBottom: '1rem' }}>
        This toggle stands in for real billing — flip it manually for now. Pro unlocks automated,
        recurring <a href="/campaigns">campaigns</a>; Free clinics can still send any campaign manually, any time.
      </p>
      <table className="tbl">
        <thead><tr><th>Plan</th><th>What it unlocks</th><th></th></tr></thead>
        <tbody>
          <tr>
            <td>Free</td>
            <td>Manual campaign sends, daily appointment/recall reminders</td>
            <td>{plan === 'free' ? <span className="badge b-completed">current</span> : <button className="btn sm ghost" onClick={() => setPlanTo('free')}>Switch to Free</button>}</td>
          </tr>
          <tr>
            <td>Pro</td>
            <td>Everything in Free, plus automated recurring campaigns</td>
            <td>{plan === 'pro' ? <span className="badge b-completed">current</span> : <button className="btn sm" onClick={() => setPlanTo('pro')}>Switch to Pro</button>}</td>
          </tr>
        </tbody>
      </table>

      <div className="pagehead" style={{ marginTop: '2rem' }}><h2>WhatsApp booking bot</h2></div>
      <p style={{ fontSize: '.74rem', color: 'var(--mid)', marginBottom: '1rem' }}>
        When enabled, patients can check slots and book/cancel/reschedule appointments by messaging the clinic's WhatsApp number.
        Requires <code>OPENAI_API_KEY</code> to be set on the server — the bot silently stays off without it, even if enabled here.
      </p>
      <label><input type="checkbox" style={{ width: 'auto', marginRight: '.4rem' }} checked={bot.booking_bot_enabled} onChange={e => setBot(b => ({ ...b, booking_bot_enabled: e.target.checked }))} />Enable booking bot</label>

      <div className="mrow" style={{ marginTop: '.75rem' }}>
        <div><label>Escalation WhatsApp number</label><input value={bot.escalation_phone} onChange={e => setBot(b => ({ ...b, escalation_phone: e.target.value }))} placeholder="9198xxxxxxx" /></div>
        <div><label>Slot interval (minutes)</label>
          <select value={bot.slot_interval_minutes} onChange={e => setBot(b => ({ ...b, slot_interval_minutes: e.target.value }))}>
            {[15, 30, 45, 60].map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
      </div>

      <div className="mrow">
        <div><label>Opens</label><input type="time" value={bot.open_time} onChange={e => setBot(b => ({ ...b, open_time: e.target.value }))} /></div>
        <div><label>Closes</label><input type="time" value={bot.close_time} onChange={e => setBot(b => ({ ...b, close_time: e.target.value }))} /></div>
      </div>

      <label style={{ display: 'block', marginTop: '.5rem' }}>Open days</label>
      <div style={{ display: 'flex', gap: '.75rem', marginBottom: '.75rem' }}>
        {DAY_NAMES.map((d, i) => (
          <label key={i} style={{ fontSize: '.78rem' }}>
            <input type="checkbox" style={{ width: 'auto', marginRight: '.25rem' }} checked={bot.open_days.includes(i)} onChange={() => toggleDay(i)} />{d}
          </label>
        ))}
      </div>

      <button className="btn" onClick={saveBot}>Save booking bot settings</button>
    </>
  )
}
