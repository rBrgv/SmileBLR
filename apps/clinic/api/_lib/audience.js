// Resolves a campaign's audience type into a list of patients to message.
// Shared by campaign-audience.js (preview) and send-campaign.js / run-campaigns.js (actual send).
export async function resolveAudience(admin, campaign) {
  const { audience, audience_tag } = campaign

  if (audience === 'recall_due') {
    const today = new Date().toISOString().slice(0, 10)
    const { data } = await admin.from('recall_reminders')
      .select('patient_id, patients(id, full_name, phone)')
      .lte('recall_due_date', today).eq('reminder_sent', false)
    return (data ?? []).map(r => r.patients).filter(p => p?.phone)
  }

  if (audience === 'pending_payment') {
    const { data } = await admin.from('invoices')
      .select('patient_id, patients(id, full_name, phone)')
      .in('payment_status', ['pending', 'partial'])
    const seen = new Set()
    const patients = []
    for (const row of data ?? []) {
      const p = row.patients
      if (p?.phone && !seen.has(p.id)) { seen.add(p.id); patients.push(p) }
    }
    return patients
  }

  if (audience === 'upcoming_appointment') {
    const from = new Date()
    const to = new Date(); to.setDate(to.getDate() + 7)
    const { data } = await admin.from('appointments')
      .select('patient_id, patients(id, full_name, phone)')
      .gte('appointment_time', from.toISOString()).lt('appointment_time', to.toISOString())
      .not('status', 'in', '("cancelled","no_show")')
    const seen = new Set()
    const patients = []
    for (const row of data ?? []) {
      const p = row.patients
      if (p?.phone && !seen.has(p.id)) { seen.add(p.id); patients.push(p) }
    }
    return patients
  }

  if (audience === 'custom_tag') {
    if (!audience_tag) return []
    const { data } = await admin.from('patients').select('id, full_name, phone').contains('tags', [audience_tag])
    return (data ?? []).filter(p => p?.phone)
  }

  return []
}
