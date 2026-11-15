import { StatusBadge, type Tone } from '@helvetly/ui/components/status-badge'

import type { EmployeeStatus } from '@/lib/employees'

const STATUS: Record<EmployeeStatus, { tone: Tone; label: string }> = {
  active: { tone: 'green', label: 'Active' },
  upcoming: { tone: 'blue', label: 'Upcoming' },
  ended: { tone: 'gray', label: 'Ended' },
  archived: { tone: 'gray', label: 'Archived' },
}

/** Derived by the server from the dates and the archive, as of today. */
export function EmployeeStatusBadge({ status }: { status: EmployeeStatus }) {
  return <StatusBadge tone={STATUS[status].tone}>{STATUS[status].label}</StatusBadge>
}
