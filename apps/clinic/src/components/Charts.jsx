import { inr } from '../lib/format'

// Vertical bar chart — magnitude over time, single hue, direct value labels.
export function RevenueChart({ data }) {
  const max = Math.max(1, ...data.map(d => d.amount))
  const w = 560, h = 200, padL = 8, padB = 28, padT = 22, barGap = 14
  const barW = (w - padL * 2 - barGap * (data.length - 1)) / data.length

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="chart" role="img" aria-label="Revenue by month">
      <line x1={padL} y1={h - padB} x2={w - padL} y2={h - padB} stroke="var(--rule)" strokeWidth="1" />
      {data.map((d, i) => {
        const barH = (d.amount / max) * (h - padT - padB)
        const x = padL + i * (barW + barGap)
        const y = h - padB - barH
        return (
          <g key={d.month}>
            <title>{d.month}: {inr(d.amount)}</title>
            <rect x={x} y={y} width={barW} height={Math.max(barH, 1)} rx="4" fill="var(--purple)" />
            {d.amount > 0 && (
              <text x={x + barW / 2} y={y - 6} textAnchor="middle" fontSize="9" fill="var(--mid)">
                {inr(d.amount)}
              </text>
            )}
            <text x={x + barW / 2} y={h - padB + 14} textAnchor="middle" fontSize="9" fill="var(--soft)">
              {d.month}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

// Horizontal ranked bar list — magnitude across named categories, single hue.
export function LeadSourceChart({ data }) {
  const max = Math.max(1, ...data.map(d => d.count))
  const rowH = 30
  const w = 560, h = data.length * rowH + 8
  const labelW = 130, padR = 40

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="chart" role="img" aria-label="Bookings by lead source">
      {data.map((d, i) => {
        const barMaxW = w - labelW - padR
        const barW = (d.count / max) * barMaxW
        const y = i * rowH
        return (
          <g key={d.source}>
            <title>{d.label}: {d.count}</title>
            <text x={labelW - 10} y={y + rowH / 2 + 4} textAnchor="end" fontSize="10" fill="var(--mid)">
              {d.label}
            </text>
            <rect x={labelW} y={y + 6} width={Math.max(barW, 2)} height={rowH - 12} rx="4" fill="var(--purple)" />
            <text x={labelW + barW + 8} y={y + rowH / 2 + 4} fontSize="10" fill="var(--ink)">
              {d.count}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
