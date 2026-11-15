import { PageTitle } from '@/components/page-title'
import { AuditLogSettings } from '@/components/settings/audit-log'

export default function Page() {
  return (
    <>
      <PageTitle message="auditLog" />
      <AuditLogSettings />
    </>
  )
}
