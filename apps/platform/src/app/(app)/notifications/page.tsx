import type { Metadata } from 'next'

import { NotificationsPage } from '@/components/notifications/notifications-page'
import { translate } from '@/lib/i18n'

export const metadata: Metadata = { title: translate('notifications') }

export default function Page() {
  return <NotificationsPage />
}
