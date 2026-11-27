import { DevelopersPage } from '@/components/api/developers-page'
import { PageTitle } from '@/components/page-title'

export default function Page() {
  return (
    <>
      <PageTitle message="apiMCP" />
      <DevelopersPage />
    </>
  )
}
