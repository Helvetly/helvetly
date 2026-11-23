'use client'
import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'

import { PageTitle } from '@/components/page-title'
import { LinkBooking } from '@/components/portal-book'

/** A public booking link (`/booking?link=…`): no session, the link names the workspace. */
function FromLink() {
  return <LinkBooking token={useSearchParams().get('link') ?? ''} />
}

export default function BookingLinkPage() {
  return (
    <>
      <PageTitle message="bookTitle" />
      <main className="min-h-svh bg-background">
        <Suspense>
          <FromLink />
        </Suspense>
      </main>
    </>
  )
}
