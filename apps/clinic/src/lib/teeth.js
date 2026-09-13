// FDI two-digit tooth numbering (ISO 3950) — the notation Indian dentists use.
// First digit = quadrant, second = position from the midline.
//   Adult (permanent): quadrants 1–4, teeth 1–8  → 11–18, 21–28, 31–38, 41–48
//   Child (primary):   quadrants 5–8, teeth 1–5  → 51–55, 61–65, 71–75, 81–85
// Adult and child numbers never overlap, so a mixed-dentition patient's
// permanent and milk teeth live side by side in the same tables.

const range = (q, count, reverse) => {
  const r = Array.from({ length: count }, (_, i) => q * 10 + i + 1)
  return reverse ? r.reverse() : r
}

// Rows as they appear on a chart: patient's right on the viewer's left.
export const DENTITIONS = {
  adult: {
    label: 'Adult',
    upper: [range(1, 8, true), range(2, 8)],
    lower: [range(4, 8, true), range(3, 8)],
  },
  child: {
    label: 'Child',
    upper: [range(5, 5, true), range(6, 5)],
    lower: [range(8, 5, true), range(7, 5)],
  },
}

export const ADULT_TEETH = [...DENTITIONS.adult.upper.flat(), ...DENTITIONS.adult.lower.flat()]
export const CHILD_TEETH = [...DENTITIONS.child.upper.flat(), ...DENTITIONS.child.lower.flat()]

export function isChildTooth(n) {
  return Math.floor(n / 10) >= 5
}

export function isValidTooth(n) {
  const q = Math.floor(n / 10), p = n % 10
  return (q >= 1 && q <= 4 && p >= 1 && p <= 8) || (q >= 5 && q <= 8 && p >= 1 && p <= 5)
}

export function toothLabel(n) {
  return `Tooth ${n}${isChildTooth(n) ? ' (milk)' : ''}`
}

// Under 12 is still mostly primary / mixed dentition, so open the child chart first.
export function defaultDentition(dateOfBirth) {
  if (!dateOfBirth) return 'adult'
  const age = (Date.now() - new Date(dateOfBirth)) / (365.25 * 24 * 3600 * 1000)
  return age < 12 ? 'child' : 'adult'
}
