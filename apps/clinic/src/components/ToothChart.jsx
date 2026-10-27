import { useState } from 'react'
import { DENTITIONS, isChildTooth, defaultDentition, isValidTooth } from '../lib/teeth'

const CONDS = ['Decayed', 'Filled', 'Missing', 'Crowned', 'RootCanal', 'Implant', 'Healthy']

export { CONDS as TOOTH_CONDITIONS }

export default function ToothChart({ teeth, dateOfBirth, onSelect, readOnly = false }) {
  const [view, setView] = useState(() => defaultDentition(dateOfBirth))
  const map = {}
  teeth.forEach(t => { map[t.tooth_number] = t })
  // Recorded-tooth counts per chart, so data on the hidden chart isn't forgotten.
  const counts = { adult: 0, child: 0 }
  teeth.forEach(t => { counts[isChildTooth(t.tooth_number) ? 'child' : 'adult']++ })
  const d = DENTITIONS[view]

  const quad = nums => (
    <div className="quad" style={{ gridTemplateColumns: `repeat(${nums.length},1fr)` }}>
      {nums.map(n => {
        const t = map[n]
        return (
          <button disabled={readOnly} key={n}
            className={`tooth ${t?.condition ? 't-' + t.condition : ''}`}
            title={t ? `${t.condition}${t.notes ? ' · ' + t.notes : ''}` : ''}
            onClick={() => onSelect(n, t)}>{n}</button>
        )
      })}
    </div>
  )

  return (
    <>
      {teeth.some(t => !isValidTooth(t.tooth_number)) && <div className="allergy-alert"><p>Legacy tooth numbers need clinician review. No automatic renumbering has been applied.</p>{teeth.filter(t => !isValidTooth(t.tooth_number)).map(t => <p key={t.id}>Recorded number {t.tooth_number} · {t.condition} · {t.notes} {!readOnly && <button className="btn sm ghost" onClick={() => onSelect(t.tooth_number,t)}>Correct numbering</button>}</p>)}</div>}
      <div style={{ display: 'flex', gap: '.4rem', marginBottom: '.75rem' }}>
        {Object.entries(DENTITIONS).map(([k, v]) => (
          <button key={k} className={'btn sm' + (view === k ? '' : ' ghost')} onClick={() => setView(k)}>
            {v.label} teeth{counts[k] ? ` · ${counts[k]}` : ''}
          </button>
        ))}
      </div>
      <div className="legend">
        {CONDS.map(c => <span key={c}><i className={`t-${c}`} />{c === 'RootCanal' ? 'Root canal' : c}</span>)}
      </div>
      <div className={'teeth ' + view}>
        <div className="jaw-label"><span>Upper right</span><span>Upper left</span></div>
        <div className="jaw upper">{quad(d.upper[0])}{quad(d.upper[1])}</div>
        <div className="jaw lower">{quad(d.lower[0])}{quad(d.lower[1])}</div>
        <div className="jaw-label"><span>Lower right</span><span>Lower left</span></div>
      </div>
      <p style={{ fontSize: '.68rem', color: 'var(--soft)' }}>
        FDI numbering — {view === 'adult' ? 'permanent teeth 11–48' : 'milk teeth 51–85'}. {readOnly ? 'Clinical chart is read-only for your role.' : 'Click a tooth to set its condition.'}
      </p>
    </>
  )
}
