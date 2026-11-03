// The screens speak the clinic's vocabulary; the database keeps snake_case.
// Renaming the stored values would mean rewriting every imported row for no
// gain, so the translation lives here instead.
const LABELS = {
  pending: 'Planned',
  scheduled: 'Scheduled',
  in_progress: 'In Progress',
  completed: 'Completed',
  not_treated: 'Not Treated',
  proposed: 'Proposed',
  accepted: 'Accepted',
  cancelled: 'Cancelled',
}

export const statusLabel = s => LABELS[s] ?? (s || '').replace(/_/g, ' ')
