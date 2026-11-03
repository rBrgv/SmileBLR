import { statusLabel } from '../lib/status'

export default function StatusSelect({ value, options, onChange, disabled = false }) {
  return (
    <select disabled={disabled} style={{ width: 'auto', fontSize: '.68rem' }} value={value} onChange={e => onChange(e.target.value)}>
      {options.map(s => <option key={s} value={s}>{statusLabel(s)}</option>)}
    </select>
  )
}
