import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { ageLabel } from '../lib/age'
import { fmtD } from '../lib/format'
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
    ['/activity-log', 'Activity Log'], ['/data-export', 'Data Export'], ['/patient-import', 'Patient Import'],
    ['/campaigns', 'Campaigns'], ['/trash', 'Trash'],
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
      // Name, phone, our id and the clinic's file number — whichever the
      // caller happens to have in front of them.
      const term = q.trim().replace(/[\\%_]/g, c => '\\' + c)
      const pattern = JSON.stringify('%' + term + '%')
      const cols = 'id,full_name,phone,patient_code,manual_id,date_of_birth,approx_age,approx_age_recorded_on'
      const { data } = await sb.from('patients').select(cols).is('merged_into', null).is('deleted_at', null)
        .or(`full_name.ilike.${pattern},phone.ilike.${pattern},patient_code.ilike.${pattern},manual_id.ilike.${pattern}`)
        .limit(8)
      const merged = data ?? []

      // One extra round trip for the whole page of suggestions, not one each.
      if (merged.length) {
        const { data: visits } = await sb.from('treatment_records')
          .select('patient_id, performed_date').in('patient_id', merged.map(p => p.id))
          .not('performed_date', 'is', null).order('performed_date', { ascending: false })
        const last = new Map()
        for (const v of visits ?? []) if (!last.has(v.patient_id)) last.set(v.patient_id, v.performed_date)
        for (const p of merged) p.last_visit = last.get(p.id) ?? null
      }
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
              <b>{p.full_name}</b>
              <span>
                {p.patient_code}
                {p.manual_id && ' · ' + p.manual_id}
                {ageLabel(p) && ' · age ' + ageLabel(p)}
                {p.phone && p.phone !== 'N/A' ? ' · ' + p.phone : ''}
                {p.last_visit ? ' · last visit ' + fmtD(p.last_visit) : ' · no visits recorded'}
              </span>
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
