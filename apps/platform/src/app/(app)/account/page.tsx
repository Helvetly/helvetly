import type { Metadata } from 'next'

import { AccountSettings } from '@/components/account/account-settings'
import { translate } from '@/lib/i18n'

export const metadata: Metadata = { title: translate('accountSettings') }

export default function AccountPage() {
  return <AccountSettings />
}
