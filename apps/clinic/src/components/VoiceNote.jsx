import { useEffect, useRef, useState } from 'react'

// Dictation for any notes field via the Web Speech API (Chrome/Edge only).
export default function VoiceNote({ value, onChange, rows = 3, placeholder }) {
  const [listening, setListening] = useState(false)
  const recRef = useRef(null)
  const SR = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition)

  useEffect(() => () => recRef.current?.stop(), [])

  function toggle() {
    if (listening) { recRef.current?.stop(); return }
    const rec = new SR()
    rec.lang = 'en-IN'
    rec.interimResults = false
    rec.continuous = true
    const base = (value || '').trim()
    let transcript = ''
    rec.onresult = e => {
      for (let i = e.resultIndex; i < e.results.length; i++) transcript += e.results[i][0].transcript + ' '
      onChange((base ? base + ' ' : '') + transcript.trim())
    }
    rec.onend = () => setListening(false)
    rec.onerror = () => setListening(false)
    recRef.current = rec
    rec.start()
    setListening(true)
  }

  return (
    <div className="voice-wrap">
      <textarea rows={rows} placeholder={placeholder} value={value || ''} onChange={e => onChange(e.target.value)} />
      {SR && (
        <button type="button" className={'btn sm ghost voice-btn' + (listening ? ' listening' : '')} onClick={toggle}>
          {listening ? '● Listening…' : '🎤 Dictate'}
        </button>
      )}
    </div>
  )
}
