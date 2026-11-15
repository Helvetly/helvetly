import type { Metadata } from 'next'

import { AuditLogSettings } from '@/components/settings/audit-log'
import { translate } from '@/lib/i18n'

export const metadata: Metadata = { title: translate('auditLog') }

export default function Page() {
  return <AuditLogSettings />
}
