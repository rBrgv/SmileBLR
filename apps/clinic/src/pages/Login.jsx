import { useState } from 'react'
import { sb } from '../lib/supabase'

export default function Login() {
  const [mode, setMode] = useState('login') // 'login' | 'reset'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  const [sent, setSent] = useState(false)

  async function signIn() {
    setErr('')
    const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password })
    if (error) setErr(error.message)
  }

  async function sendReset() {
    setErr('')
    if (!email.trim()) return setErr('Enter your email first.')
    const { error } = await sb.auth.resetPasswordForEmail(email.trim(), { redirectTo: window.location.origin })
    if (error) return setErr(error.message)
    setSent(true)
  }

  if (mode === 'reset') {
    return (
      <div className="login">
        <h2>Reset your password</h2>
        <p>{sent ? 'Check your email for a reset link.' : "We'll email you a link to set a new password."}</p>
        {!sent && (
          <>
            <label>Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="username"
              onKeyDown={e => e.key === 'Enter' && sendReset()} />
            <button className="btn" style={{ width: '100%', marginTop: '1.25rem' }} onClick={sendReset}>Send reset link</button>
          </>
        )}
        <button className="btn ghost" style={{ width: '100%', marginTop: '.6rem' }} onClick={() => { setMode('login'); setErr(''); setSent(false) }}>
          Back to sign in
        </button>
        {err && <div className="err">{err}</div>}
      </div>
    )
  }

  return (
    <div className="login">
      <h2>Smile Bengaluru · Clinic</h2>
      <p>Staff sign in</p>
      <label>Email</label>
      <input type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="username" />
      <label>Password</label>
      <input type="password" value={password} onChange={e => setPassword(e.target.value)}
        autoComplete="current-password" onKeyDown={e => e.key === 'Enter' && signIn()} />
      <button className="btn" style={{ width: '100%', marginTop: '1.25rem' }} onClick={signIn}>Sign in</button>
      <button className="btn ghost" style={{ width: '100%', marginTop: '.6rem' }} onClick={() => { setMode('reset'); setErr('') }}>
        Forgot password?
      </button>
      {err && <div className="err">{err}</div>}
    </div>
  )
}
