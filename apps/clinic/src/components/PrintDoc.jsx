// Shared shell for printable documents — no sidebar (mounted outside <Layout>),
// clean letterhead, and a Print button that hides itself in the print output
// via the @media print rules in styles.css. The browser's own "Save as PDF"
// print destination covers the PDF-export need without a new dependency.
export default function PrintDoc({ title, children }) {
  return (
    <div className="print-doc">
      <div className="print-actions">
        <button className="btn" onClick={() => window.print()}>Print / Save as PDF</button>
      </div>
      <div className="print-sheet">
        <div className="print-header">
          <h1>Smile Bengaluru</h1>
          <p>Dental Clinic · Bengaluru</p>
        </div>
        <h2 className="print-title">{title}</h2>
        {children}
      </div>
    </div>
  )
}
