import { StatusBadge, type Tone } from '@helvetly/ui/components/status-badge'

import type { EmployeeStatus } from '@/lib/employees'
import { translate } from '@/lib/i18n'

const STATUS: Record<EmployeeStatus, { tone: Tone; label: string }> = {
  active: { tone: 'green', label: translate('employeeStatusActive') },
  upcoming: { tone: 'blue', label: translate('employeeStatusUpcoming') },
  ended: { tone: 'gray', label: translate('employeeStatusEnded') },
  archived: { tone: 'gray', label: translate('employeeStatusArchived') },
}

/** Derived by the server from the dates and the archive, as of today. */
export function EmployeeStatusBadge({ status }: { status: EmployeeStatus }) {
  return <StatusBadge tone={STATUS[status].tone}>{STATUS[status].label}</StatusBadge>
}
