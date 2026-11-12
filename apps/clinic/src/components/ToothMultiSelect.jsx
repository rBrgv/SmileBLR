import { ADULT_TEETH, CHILD_TEETH } from '../lib/teeth'

const sorted = a => [...a].sort((x, y) => x - y)

// Several teeth for one procedure, e.g. caps measured for two teeth. Chosen
// teeth show as chips that can be removed; the list only offers teeth not
// already chosen, so the same tooth cannot be added twice.
export default function ToothMultiSelect({ value, onChange }) {
  const chosen = new Set(value)
  const add = e => { const n = parseInt(e.target.value); if (n) onChange(sorted([...value, n])) }
  return (
    <>
      {value.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.35rem', marginBottom: '.35rem' }}>
          {value.map(n => (
            <button type="button" key={n} className="btn sm ghost" title="Remove this tooth" onClick={() => onChange(value.filter(x => x !== n))}>{n} ✕</button>
          ))}
        </div>
      )}
      <select value="" onChange={add}>
        <option value="">{value.length ? 'Add another tooth…' : '—'}</option>
        <optgroup label="Adult (permanent)">
          {sorted(ADULT_TEETH).filter(n => !chosen.has(n)).map(n => <option key={n} value={n}>{n}</option>)}
        </optgroup>
        <optgroup label="Child (milk)">
          {sorted(CHILD_TEETH).filter(n => !chosen.has(n)).map(n => <option key={n} value={n}>{n}</option>)}
        </optgroup>
      </select>
    </>
  )
}
