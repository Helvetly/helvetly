import type { Metadata } from 'next'

import { AuditLogSettings } from '@/components/settings/audit-log'

export const metadata: Metadata = { title: 'Audit log' }

export default function Page() {
  return <AuditLogSettings />
}
