import { sb } from './supabase'

// Curated audit trail — call this from specific high-value mutations
// (staff/role changes, permanent deletes, plan approval, consent signing),
// not from every CRUD action. A log of everything is a log of nothing.
export async function logActivity(action, entityType, entityId, summary) {
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return
  const { data: staffRow } = await sb.from('staff').select('id').eq('user_id', user.id).maybeSingle()
  await sb.from('activity_log').insert({
    actor_id: staffRow?.id || null, action, entity_type: entityType, entity_id: entityId || null, summary,
  })
}
