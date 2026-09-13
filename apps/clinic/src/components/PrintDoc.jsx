import { CLINIC } from '../lib/clinicInfo'
import logo from '../assets/logo.png'

// Shared shell for printable documents — no sidebar (mounted outside <Layout>),
// the clinic's letterhead, and a Print button that hides itself in the print
// output via the @media print rules in styles.css. The browser's own
// "Save as PDF" print destination covers the PDF-export need without a new
// dependency.
export default function PrintDoc({ title, children }) {
  return (
    <div className="print-doc">
      <div className="print-actions">
        <button className="btn" onClick={() => window.print()}>Print / Save as PDF</button>
      </div>
      <div className="print-sheet">
        <div className="letterhead">
          <div className="lh-name">
            <h1>{CLINIC.name}</h1>
            <p className="lh-tagline">{CLINIC.tagline}</p>
            <p className="lh-doctor">{CLINIC.doctor.name}</p>
            <ul className="lh-credentials">
              {CLINIC.doctor.credentials.map(c => <li key={c}>{c}</li>)}
            </ul>
            <p className="lh-doctor-title">{CLINIC.doctor.title}</p>
          </div>
          <img className="lh-mark" src={logo} alt={CLINIC.name + ' logo'} />
        </div>
        <h2 className="print-title">{title}</h2>
        {children}
        <div className="letterfoot">
          <p className="lf-specialties">
            Specialists in: {CLINIC.specialties.map((s, i) => (
              <span key={s}>{i > 0 && ' • '}{s}</span>
            ))}
          </p>
          <p className="lf-address"><b>Address:</b> {CLINIC.address}</p>
          <p className="lf-contact">
            <b>Phone:</b> {CLINIC.phoneMobile} (M) &nbsp;{CLINIC.phoneLandline} (L) &nbsp;
            <b>E-mail:</b> {CLINIC.email}
          </p>
          <p className="lf-emergency">For Emergency Call: {CLINIC.emergencyPhone}</p>
        </div>
      </div>
    </div>
  )
}
