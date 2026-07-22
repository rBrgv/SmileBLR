import { useEffect, useState } from 'react'
import { Routes, Route } from 'react-router-dom'
import { sb } from './lib/supabase'
import { ToastProvider } from './components/Toast'
import { RoleProvider } from './lib/RoleContext'
import Layout from './components/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Bookings from './pages/Bookings'
import Patients from './pages/Patients'
import PatientDetail from './pages/PatientDetail'
import Appointments from './pages/Appointments'
import Waitlist from './pages/Waitlist'
import Invoices from './pages/Invoices'
import Recall from './pages/Recall'
import Treatments from './pages/Treatments'
import Inventory from './pages/Inventory'
import Staff from './pages/Staff'
import TreatmentPlans from './pages/TreatmentPlans'
import TreatmentRecords from './pages/TreatmentRecords'
import XRays from './pages/XRays'
import LabOrders from './pages/LabOrders'
import Referrals from './pages/Referrals'
import ConsentForms from './pages/ConsentForms'
import InsuranceClaims from './pages/InsuranceClaims'
import Trash from './pages/Trash'
import PrintInvoice from './pages/PrintInvoice'
import PrintPrescription from './pages/PrintPrescription'
import PrintConsent from './pages/PrintConsent'
import PrintPostOp from './pages/PrintPostOp'
import PrintDaySheet from './pages/PrintDaySheet'
import PrintTreatmentPlan from './pages/PrintTreatmentPlan'
import ComplianceLogs from './pages/ComplianceLogs'
import ActivityLog from './pages/ActivityLog'
import ResetPassword from './pages/ResetPassword'
import DataExport from './pages/DataExport'

export default function App() {
  const [session, setSession] = useState(undefined) // undefined = loading
  const [recovery, setRecovery] = useState(false)

  useEffect(() => {
    sb.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = sb.auth.onAuthStateChange((event, s) => {
      if (event === 'PASSWORD_RECOVERY') setRecovery(true)
      setSession(s)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  if (session === undefined) return <div className="empty" style={{ marginTop: '20vh', border: 'none' }}>Loading…</div>
  if (recovery) return <ToastProvider><ResetPassword onDone={() => setRecovery(false)} /></ToastProvider>
  if (!session) return <ToastProvider><Login /></ToastProvider>

  return (
    <ToastProvider>
      <RoleProvider userId={session.user.id}>
        <Routes>
          <Route path="/print/invoice/:id" element={<PrintInvoice />} />
          <Route path="/print/prescription/:id" element={<PrintPrescription />} />
          <Route path="/print/consent/:id" element={<PrintConsent />} />
          <Route path="/print/post-op/:id" element={<PrintPostOp />} />
          <Route path="/print/day/:date" element={<PrintDaySheet />} />
          <Route path="/print/plan/:id" element={<PrintTreatmentPlan />} />
          <Route element={<Layout />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/bookings" element={<Bookings />} />
            <Route path="/patients" element={<Patients />} />
            <Route path="/patients/:id" element={<PatientDetail />} />
            <Route path="/appointments" element={<Appointments />} />
            <Route path="/waitlist" element={<Waitlist />} />
            <Route path="/treatment-plans" element={<TreatmentPlans />} />
            <Route path="/treatment-records" element={<TreatmentRecords />} />
            <Route path="/xrays" element={<XRays />} />
            <Route path="/lab-orders" element={<LabOrders />} />
            <Route path="/referrals" element={<Referrals />} />
            <Route path="/consent-forms" element={<ConsentForms />} />
            <Route path="/invoices" element={<Invoices />} />
            <Route path="/insurance-claims" element={<InsuranceClaims />} />
            <Route path="/trash" element={<Trash />} />
            <Route path="/recall" element={<Recall />} />
            <Route path="/treatments" element={<Treatments />} />
            <Route path="/inventory" element={<Inventory />} />
            <Route path="/staff" element={<Staff />} />
            <Route path="/compliance" element={<ComplianceLogs />} />
            <Route path="/activity-log" element={<ActivityLog />} />
            <Route path="/data-export" element={<DataExport />} />
          </Route>
        </Routes>
      </RoleProvider>
    </ToastProvider>
  )
}
