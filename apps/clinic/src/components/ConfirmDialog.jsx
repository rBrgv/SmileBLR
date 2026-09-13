export default function ConfirmDialog({ title = 'Are you sure?', body, confirmLabel = 'Delete', onConfirm, onCancel }) {
  return (
    <div className="overlay" onClick={e => e.target.classList.contains('overlay') && onCancel()}>
      <div className="modal confirm-modal">
        <button className="x" onClick={onCancel}>✕</button>
        <h3>{title}</h3>
        {body && <p>{body}</p>}
        <div className="confirm-actions">
          <button className="btn ghost" onClick={onCancel}>Cancel</button>
          <button className="btn danger" onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  )
}
