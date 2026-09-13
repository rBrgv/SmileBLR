export default function Modal({ title, onClose, children, wide }) {
  return (
    <div className="overlay" onClick={e => e.target.classList.contains('overlay') && onClose()}>
      <div className={'modal' + (wide ? ' wide' : '')}>
        <button className="x" onClick={onClose}>✕</button>
        {title && <h3>{title}</h3>}
        {children}
      </div>
    </div>
  )
}
