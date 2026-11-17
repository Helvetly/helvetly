import { PageTitle } from '@/components/page-title'
import { PeriodsSettings } from '@/components/settings/periods-settings'

export default function Page() {
  return (
    <>
      <PageTitle message="monthEndClose" />
      <PeriodsSettings />
    </>
  )
}
