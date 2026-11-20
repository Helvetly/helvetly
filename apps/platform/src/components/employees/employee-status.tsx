import { Badge } from '@helvetly/ui/components/badge'
import { STATUS_TONES } from '@helvetly/ui/lib/status-tones'

import type { EmployeeStatus } from '@/lib/employees'
import { translate } from '@/lib/i18n'

const LABELS: Record<EmployeeStatus, string> = {
  active: translate('employeeStatusActive'),
  upcoming: translate('employeeStatusUpcoming'),
  ended: translate('employeeStatusEnded'),
  archived: translate('employeeStatusArchived'),
}

/** Derived by the server from the dates and the archive, as of today. */
export function EmployeeStatusBadge({ status }: { status: EmployeeStatus }) {
  return <Badge tone={STATUS_TONES.employee[status]}>{LABELS[status]}</Badge>
}
