import type { Metadata } from 'next'

import { PrefsRedirect } from '@/components/notifications/prefs-redirect'

export const metadata: Metadata = { title: 'Notifications' }

/** Was the preferences tab: old links land on the Notifications page with the drawer open. */
export default function NotificationsSettingsPage() {
  return <PrefsRedirect />
}
