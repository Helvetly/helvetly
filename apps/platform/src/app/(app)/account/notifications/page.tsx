import type { Metadata } from 'next'

import { PrefsRedirect } from '@/components/notifications/prefs-redirect'
import { translate } from '@/lib/i18n'

export const metadata: Metadata = { title: translate('notifications') }

/** Was the preferences tab: old links land on the Notifications page with the drawer open. */
export default function NotificationsSettingsPage() {
  return <PrefsRedirect />
}
