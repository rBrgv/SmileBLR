import { createContext, useContext, useEffect, useState } from 'react'
import { sb } from './supabase'

const RoleCtx = createContext(null)
export const useRole = () => useContext(RoleCtx)

// Role is UI-level convenience only — the real enforcement lives in RLS
// policies (see supabase/migrations/004_roles_and_permissions.sql). Before
// that migration runs, staff.user_id doesn't exist yet, so this fails soft
// to null (no elevated permissions shown) rather than breaking the app.
export function RoleProvider({ userId, children }) {
  const [failure, setFailure] = useState(null)
  const [role, setRole] = useState(undefined) // undefined = loading, null = no linked staff row

  useEffect(() => {
    if (!userId) { setRole(null); return }
    sb.from('staff').select('role').eq('user_id', userId).eq('active', true).maybeSingle()
      .then(({ data, error }) => { setFailure(error?.message || null); setRole(error ? null : (data?.role ?? null)) })
  }, [userId])

  if (role === undefined) return <div className="empty">Checking staff access…</div>
  if (role === null) return <div className="empty"><p>{failure ? 'Could not verify staff access. Reload to retry.' : 'This login is not linked to an active staff account. Ask the clinic administrator to link or activate it.'}</p><button className="btn ghost" onClick={() => location.reload()}>Retry</button>{' '}<button className="btn" onClick={() => sb.auth.signOut()}>Sign out</button></div>
  return <RoleCtx.Provider value={role}>{children}</RoleCtx.Provider>
}
