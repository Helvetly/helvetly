import { PageTitle } from '@/components/page-title'
import { SchedulingSettingsPage } from '@/components/scheduling/settings/scheduling-settings'

export default function Page() {
  return (
    <>
      <PageTitle message="schedulingSettingsTitle" />
      <SchedulingSettingsPage />
    </>
  )
}
