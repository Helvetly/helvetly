import { MembersPage } from '@/components/members/members-page'
import { PageTitle } from '@/components/page-title'

export default function Page() {
  return (
    <>
      <PageTitle message="members" />
      <MembersPage />
    </>
  )
}
