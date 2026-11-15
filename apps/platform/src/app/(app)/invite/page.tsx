import type { Metadata } from 'next'
import { Suspense } from 'react'

import { AcceptInvitation } from '@/components/members/accept-invitation'
import { translate } from '@/lib/i18n'

export const metadata: Metadata = { title: translate('joinWorkspace') }

export default function InvitePage() {
  return (
    <Suspense>
      <AcceptInvitation />
    </Suspense>
  )
}
