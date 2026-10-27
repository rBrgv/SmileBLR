import { useRole } from '../lib/RoleContext'
import { canWriteClinical } from '../lib/clinical'
export default function ClinicalButton({ disabled, children, ...props }) {
  const allowed = canWriteClinical(useRole())
  return <button {...props} disabled={disabled || !allowed} title={!allowed ? 'Doctor or admin access required' : props.title}>{children}</button>
}
