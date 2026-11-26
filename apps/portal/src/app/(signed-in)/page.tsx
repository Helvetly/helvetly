'use client'
import { PageTitle } from '@/components/page-title'
import { PortalOverview } from '@/components/portal-overview'
import { PortalSessions } from '@/components/portal-sessions'
import { usePortalSession } from '@/components/portal-shell'

/** The client's overview; a participant's home is their sessions (the company's overview is not theirs). */
export default function PortalPage() {
  const participant = usePortalSession().participant
  return participant ? (
    <>
      <PageTitle message="sessions" />
      <PortalSessions />
    </>
  ) : (
    <>
      <PageTitle message="overview" />
      <PortalOverview />
    </>
  )
}
