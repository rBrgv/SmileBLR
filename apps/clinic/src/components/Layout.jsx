import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'

const sections = [
  { label: null, links: [['/', 'Dashboard']] },
  { label: 'Front Desk', links: [
    ['/bookings', 'Bookings'], ['/patients', 'Patients'], ['/appointments', 'Appointments'], ['/waitlist', 'Waitlist'], ['/recall', 'Recall Reminders'],
  ] },
  { label: 'Clinical', links: [
    ['/treatment-plans', 'Treatment Plans'], ['/treatment-records', 'Treatment Records'], ['/xrays', 'X-Rays'],
    ['/lab-orders', 'Lab Orders'], ['/referrals', 'Referrals'], ['/consent-forms', 'Consent Forms'],
  ] },
  { label: 'Financial', links: [['/invoices', 'Invoices'], ['/insurance-claims', 'Insurance Claims']] },
  { label: 'Admin', links: [
    ['/treatments', 'Treatments'], ['/inventory', 'Inventory'], ['/staff', 'Staff'], ['/compliance', 'Compliance Logs'],
    ['/activity-log', 'Activity Log'], ['/data-export', 'Data Export'], ['/trash', 'Trash'],
  ] },
]

function PatientQuickSearch() {
  const [q, setQ] = useState('')
  const [results, setResults] = useState([])
  const [open, setOpen] = useState(false)
  const routerNav = useNavigate()

  useEffect(() => {
    if (!q.trim()) { setResults([]); return }
    const t = setTimeout(async () => {
      const [byName, byPhone] = await Promise.all([
        sb.from('patients').select('id,full_name,phone').ilike('full_name', `%${q.trim()}%`).limit(6),
        sb.from('patients').select('id,full_name,phone').ilike('phone', `%${q.trim()}%`).limit(6),
      ])
      const merged = [...(byName.data ?? []), ...(byPhone.data ?? [])]
        .filter((p, i, arr) => arr.findIndex(x => x.id === p.id) === i).slice(0, 8)
      setResults(merged)
    }, 250)
    return () => clearTimeout(t)
  }, [q])

  function pick(id) {
    setQ(''); setResults([]); setOpen(false)
    routerNav('/patients/' + id)
  }

  return (
    <div className="quick-search">
      <input placeholder="Search patients…" value={q}
        onChange={e => { setQ(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)} />
      {open && results.length > 0 && (
        <div className="quick-search-results">
          {results.map(p => (
            <div key={p.id} className="quick-search-row" onMouseDown={() => pick(p.id)}>
              <b>{p.full_name}</b><span>{p.phone}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function Layout() {
  const [open, setOpen] = useState(false)
  const routerLocation = useLocation()

  useEffect(() => { setOpen(false) }, [routerLocation.pathname])

  const nav = (
    <>
      <div className="brand">Smile Bengaluru<span>Clinic Management</span></div>
      <PatientQuickSearch />
      {sections.map((s, i) => (
        <div key={i}>
          {s.label && <div className="nav-section">{s.label}</div>}
          {s.links.map(([to, label]) => (
            <NavLink key={to} to={to} end={to === '/'}
              className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')}>{label}</NavLink>
          ))}
        </div>
      ))}
      <button className="out" onClick={async () => { await sb.auth.signOut(); location.reload() }}>Sign out</button>
    </>
  )

  return (
    <div className="shell">
      <div className="mobile-topbar">
        <div className="brand" style={{ borderBottom: 'none', paddingBottom: 0, marginBottom: 0 }}>Smile Bengaluru</div>
        <button className="menu-btn" aria-label={open ? 'Close menu' : 'Open menu'} onClick={() => setOpen(x => !x)}>{open ? '✕' : '☰'}</button>
      </div>
      <div className={'nav-backdrop' + (open ? ' open' : '')} onClick={() => setOpen(false)} />
      <nav className={'side' + (open ? ' open' : '')}>{nav}</nav>
      <main className="main"><Outlet /></main>
    </div>
  )
}
