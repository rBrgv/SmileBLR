export default function StatusBadge({ status }) {
  return <span className={`badge b-${status}`}>{(status || '').replace('_', ' ')}</span>
}
