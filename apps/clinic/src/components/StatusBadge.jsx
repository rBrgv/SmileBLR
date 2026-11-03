import { statusLabel } from '../lib/status'

export default function StatusBadge({ status }) {
  return <span className={`badge b-${status}`}>{statusLabel(status)}</span>
}
