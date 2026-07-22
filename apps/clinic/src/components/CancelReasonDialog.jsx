import { useState } from 'react'

export default function CancelReasonDialog({ status, onCancel, onConfirm }) {
  const [reason, setReason] = useState('')
  const isNoShow = status === 'no_show'
  return (
    <div className="overlay" onClick={e => e.target.classList.contains('overlay') && onCancel()}>
      <div className="modal confirm-modal">
        <button className="x" onClick={onCancel}>✕</button>
        <h3>{isNoShow ? 'Mark as no-show' : 'Cancel this appointment'}</h3>
        <label>Reason (optional)</label>
        <input autoFocus placeholder="e.g. patient called to reschedule" value={reason} onChange={e => setReason(e.target.value)} />
        <div className="confirm-actions">
          <button className="btn ghost" onClick={onCancel}>Back</button>
          <button className="btn danger" onClick={() => onConfirm(reason.trim() || null)}>{isNoShow ? 'Mark no-show' : 'Cancel appointment'}</button>
        </div>
      </div>
    </div>
  )
}
