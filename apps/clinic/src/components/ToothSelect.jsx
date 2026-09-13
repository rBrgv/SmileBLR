import { ADULT_TEETH, CHILD_TEETH } from '../lib/teeth'

const sorted = a => [...a].sort((x, y) => x - y)

// FDI tooth picker — replaces free-typed numbers so only real teeth can be saved.
export default function ToothSelect({ value, onChange, emptyLabel = '—' }) {
  return (
    <select value={value} onChange={onChange}>
      <option value="">{emptyLabel}</option>
      <optgroup label="Adult (permanent)">
        {sorted(ADULT_TEETH).map(n => <option key={n} value={n}>{n}</option>)}
      </optgroup>
      <optgroup label="Child (milk)">
        {sorted(CHILD_TEETH).map(n => <option key={n} value={n}>{n}</option>)}
      </optgroup>
    </select>
  )
}
