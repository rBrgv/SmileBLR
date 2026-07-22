export default function StatusSelect({ value, options, onChange }) {
  return (
    <select style={{ width: 'auto', fontSize: '.68rem' }} value={value} onChange={e => onChange(e.target.value)}>
      {options.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
    </select>
  )
}
