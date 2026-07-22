const CONDS = ['Decayed', 'Filled', 'Missing', 'Crowned', 'RootCanal', 'Implant', 'Healthy']

export { CONDS as TOOTH_CONDITIONS }

export default function ToothChart({ teeth, onSelect }) {
  const map = {}
  teeth.forEach(t => { map[t.tooth_number] = t })
  return (
    <>
      <div className="legend">
        {CONDS.map(c => <span key={c}><i className={`t-${c}`} />{c === 'RootCanal' ? 'Root canal' : c}</span>)}
      </div>
      <div className="teeth">
        {Array.from({ length: 32 }, (_, k) => {
          const n = k + 1, t = map[n]
          return (
            <button key={n}
              className={`tooth ${t?.condition ? 't-' + t.condition : ''}`}
              title={t ? `${t.condition}${t.notes ? ' · ' + t.notes : ''}` : ''}
              onClick={() => onSelect(n, t)}>{n}</button>
          )
        })}
      </div>
      <p style={{ fontSize: '.68rem', color: 'var(--soft)' }}>Universal numbering 1–32. Click a tooth to set its condition.</p>
    </>
  )
}
