import { useState } from 'react'
import { sb } from '../lib/supabase'
import { useToast } from '../components/Toast'

export default function ResetPassword({ onDone }) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const toast = useToast()

  async function save() {
    setErr('')
    if (password.length < 6) return setErr('Password must be at least 6 characters.')
    if (password !== confirm) return setErr('Passwords do not match.')
    setBusy(true)
    const { error } = await sb.auth.updateUser({ password })
    setBusy(false)
    if (error) return setErr(error.message)
    toast('Password updated'); onDone()
  }

  return (
    <div className="login">
      <h2>Set a new password</h2>
      <p>Choose a new password for your account.</p>
      <label>New password</label>
      <input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="new-password" />
      <label>Confirm password</label>
      <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} autoComplete="new-password"
        onKeyDown={e => e.key === 'Enter' && save()} />
      <button className="btn" style={{ width: '100%', marginTop: '1.25rem' }} disabled={busy} onClick={save}>
        {busy ? 'Saving…' : 'Update password'}
      </button>
      {err && <div className="err">{err}</div>}
    </div>
  )
}
