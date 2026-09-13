import { useEffect, useState } from 'react'
import { sb } from '../lib/supabase'
import { useToast } from '../components/Toast'
import Modal from '../components/Modal'
import { useRole } from '../lib/RoleContext'
import { logActivity } from '../lib/activityLog'

const AUDIENCES = [
  { key: 'recall_due', label: 'Recall due (overdue check-ups)' },
  { key: 'pending_payment', label: 'Pending payment' },
  { key: 'upcoming_appointment', label: 'Upcoming appointment (next 7 days)' },
  { key: 'custom_tag', label: 'Custom tag' },
]

async function callApi(path, body) {
  const { data: { session } } = await sb.auth.getSession()
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + session.access_token },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || res.statusText)
  return data
}

export default function Campaigns() {
  const [rows, setRows] = useState(null)
  const [plan, setPlan] = useState('free')
  const [show, setShow] = useState(false)
  const toast = useToast()
  const role = useRole()
  const isAdmin = role === 'admin'

  async function load() {
    const [{ data: campaigns }, { data: settings }] = await Promise.all([
      sb.from('campaigns').select('*').order('created_at', { ascending: false }),
      sb.from('clinic_settings').select('plan').eq('id', 1).maybeSingle(),
    ])
    setRows(campaigns ?? [])
    setPlan(settings?.plan ?? 'free')
  }
  useEffect(() => { load() }, [])

  async function sendNow(c) {
    try {
      const result = await callApi('/api/send-campaign', { campaign_id: c.id })
      logActivity('campaign.sent', 'campaigns', c.id, `Sent "${c.name}" — ${result.sent} sent, ${result.smsFallbacks} via SMS, ${result.skipped} already messaged today, ${result.failed} failed`)
      toast(`Sent: ${result.sent} WhatsApp, ${result.smsFallbacks} SMS, ${result.skipped} skipped, ${result.failed} failed`)
      load()
    } catch (e) { toast('Error: ' + e.message) }
  }

  async function toggleActive(c) {
    const { error } = await sb.from('campaigns').update({ active: !c.active }).eq('id', c.id)
    if (error) return toast('Error: ' + error.message)
    load()
  }

  if (!isAdmin) return <div className="empty">Only admins can manage campaigns.</div>
  if (!rows) return <div className="empty">Loading…</div>

  return (
    <>
      <div className="pagehead">
        <h2>Campaigns</h2>
        <button className="btn" onClick={() => setShow(true)}>+ New campaign</button>
      </div>
      <p style={{ fontSize: '.74rem', color: 'var(--mid)', marginBottom: '1rem' }}>
        Define a patient audience and a WhatsApp message, then send manually or — on the Pro plan — schedule it to repeat automatically.
        Currently on the <b>{plan === 'pro' ? 'Pro' : 'Free'}</b> plan. <a href="/clinic-settings">Change plan</a>.
      </p>
      {!rows.length ? (
        <div className="empty">No campaigns yet. Create one to message patients in bulk.</div>
      ) : (
        <table className="tbl">
          <thead><tr><th>Name</th><th>Audience</th><th>Repeats</th><th>Last run</th><th>Active</th><th></th></tr></thead>
          <tbody>{rows.map(c => (
            <tr key={c.id}>
              <td>{c.name}</td>
              <td>{AUDIENCES.find(a => a.key === c.audience)?.label || c.audience}</td>
              <td>{c.schedule_cron ? (plan === 'pro' ? `every ${c.schedule_cron}h` : <span title="Requires Pro plan">every {c.schedule_cron}h (paused — Free plan)</span>) : 'manual only'}</td>
              <td>{c.last_run_at ? new Date(c.last_run_at).toLocaleString('en-IN') : 'never'}</td>
              <td><input type="checkbox" style={{ width: 'auto' }} checked={c.active} onChange={() => toggleActive(c)} /></td>
              <td><button className="btn sm" onClick={() => sendNow(c)}>Send now</button></td>
            </tr>
          ))}</tbody>
        </table>
      )}
      {show && <CampaignForm plan={plan} onClose={() => setShow(false)} onDone={() => { setShow(false); load() }} />}
    </>
  )
}

function CampaignForm({ plan, onClose, onDone }) {
  const [f, setF] = useState({
    name: '', audience: 'recall_due', audience_tag: '', message_template: '',
    wa_template_name: '', schedule_hours: '', active: true,
  })
  const [preview, setPreview] = useState(null)
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  const set = k => e => setF(x => ({ ...x, [k]: e.target.value }))

  async function previewAudience() {
    // Preview needs a saved campaign row server-side to resolve against, so
    // build the resolver call with the in-progress form values directly.
    setBusy(true)
    try {
      const { data: { session } } = await sb.auth.getSession()
      const res = await fetch('/api/campaign-audience', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + session.access_token },
        body: JSON.stringify({ campaign_id: 'draft', draft: f }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setPreview(data)
    } catch (e) { toast('Error: ' + e.message) }
    setBusy(false)
  }

  async function save() {
    if (!f.name.trim()) return toast('Name required.')
    if (!f.message_template.trim()) return toast('Message required.')
    if (f.audience === 'custom_tag' && !f.audience_tag.trim()) return toast('Tag required for custom-tag audience.')
    const { error } = await sb.from('campaigns').insert({
      name: f.name.trim(), audience: f.audience,
      audience_tag: f.audience === 'custom_tag' ? f.audience_tag.trim() : null,
      message_template: f.message_template.trim(),
      wa_template_name: f.wa_template_name.trim() || null,
      schedule_cron: plan === 'pro' && f.schedule_hours ? String(parseInt(f.schedule_hours)) : null,
      active: f.active,
    })
    if (error) return toast('Error: ' + error.message)
    toast('Campaign created'); onDone()
  }

  return (
    <Modal title="New campaign" onClose={onClose}>
      <label>Name *</label><input value={f.name} onChange={set('name')} placeholder="6-month recall nudge" />
      <label>Audience</label>
      <select value={f.audience} onChange={set('audience')}>
        {AUDIENCES.map(a => <option key={a.key} value={a.key}>{a.label}</option>)}
      </select>
      {f.audience === 'custom_tag' && (
        <><label>Tag</label><input value={f.audience_tag} onChange={set('audience_tag')} placeholder="vip" /></>
      )}
      <label>Message (used for SMS fallback and as a reference — use {'{{name}}'} for the patient's name)</label>
      <textarea rows={3} value={f.message_template} onChange={set('message_template')} />
      <label>WhatsApp template name (Meta-approved)</label>
      <input value={f.wa_template_name} onChange={set('wa_template_name')} placeholder="recall_reminder" />
      <div className="mrow">
        <div>
          <label>Repeat every (hours) {plan !== 'pro' && <span style={{ color: 'var(--mid)' }}>— Pro only</span>}</label>
          <input type="number" disabled={plan !== 'pro'} value={f.schedule_hours} onChange={set('schedule_hours')} placeholder="24" />
        </div>
      </div>
      {plan !== 'pro' && (
        <p style={{ fontSize: '.74rem', color: 'var(--mid)' }}>Automated scheduling is a Pro feature — this campaign can still be sent manually below.</p>
      )}
      <div style={{ display: 'flex', gap: '.5rem', marginTop: '.5rem' }}>
        <button className="btn sm ghost" disabled={busy} onClick={previewAudience}>Preview audience</button>
        <button className="btn" onClick={save}>Save</button>
      </div>
      {preview && (
        <p style={{ fontSize: '.78rem', marginTop: '.5rem' }}>
          Matches {preview.count} patient(s){preview.preview?.length ? ': ' + preview.preview.map(p => p.full_name).join(', ') : ''}
          {preview.count > preview.preview?.length ? '…' : ''}
        </p>
      )}
    </Modal>
  )
}
