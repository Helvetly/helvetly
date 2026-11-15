import { PrefsRedirect } from '@/components/notifications/prefs-redirect'
import { PageTitle } from '@/components/page-title'

/** Was the preferences tab: old links land on the Notifications page with the drawer open. */
export default function NotificationsSettingsPage() {
  return (
    <>
      <PageTitle message="notifications" />
      <PrefsRedirect />
    </>
  )
}
