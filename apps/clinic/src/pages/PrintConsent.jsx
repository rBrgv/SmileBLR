import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { fmtD } from '../lib/format'
import PrintDoc from '../components/PrintDoc'

export default function PrintConsent() {
  const { id } = useParams()
  const [form, setForm] = useState(null)

  useEffect(() => {
    sb.from('consent_forms').select('*, patients(full_name,phone,date_of_birth)').eq('id', id).single()
      .then(({ data }) => setForm(data))
  }, [id])

  if (!form) return <div className="empty">Loading…</div>
  return (
    <PrintDoc title="Consent Form">
      <div className="print-row"><b>Patient</b><span>{form.patients?.full_name}</span></div>
      <div className="print-row"><b>Phone</b><span>{form.patients?.phone || '—'}</span></div>
      <div className="print-row"><b>Procedure</b><span>{form.procedure}</span></div>
      <div className="print-block">
        <h4>Consent statement</h4>
        <p>
          I, the undersigned, confirm that the procedure named above, its risks, benefits, and alternatives
          have been explained to me in a language I understand, and I voluntarily consent to proceed.
        </p>
      </div>
      {form.consent_given ? (
        <>
          <div className="print-row"><b>Signed</b><span>{fmtD(form.signed_date)}</span></div>
          {form.signature_data && (
            <div className="print-signature">
              <div><img src={form.signature_data} alt="Patient signature" />Patient signature</div>
            </div>
          )}
        </>
      ) : (
        <div className="print-signature">
          <div>Patient signature &amp; date</div>
          <div>Witness signature &amp; date</div>
        </div>
      )}
    </PrintDoc>
  )
}
