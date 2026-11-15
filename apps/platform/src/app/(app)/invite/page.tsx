import { Suspense } from 'react'

import { AcceptInvitation } from '@/components/members/accept-invitation'
import { PageTitle } from '@/components/page-title'

export default function InvitePage() {
  return (
    <>
      <PageTitle message="joinWorkspace" />

      <Suspense>
        <AcceptInvitation />
      </Suspense>
    </>
  )
}
