import type { Metadata } from 'next'

import { MembersPage } from '@/components/members/members-page'
import { translate } from '@/lib/i18n'

export const metadata: Metadata = { title: translate('members') }

export default function Page() {
  return <MembersPage />
}
