import type { Metadata } from 'next'
import { Suspense } from 'react'

import { AcceptInvitation } from '@/components/members/accept-invitation'

export const metadata: Metadata = { title: 'Join workspace' }

export default function InvitePage() {
  return (
    <Suspense>
      <AcceptInvitation />
    </Suspense>
  )
}
