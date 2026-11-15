import { Welcome } from '@/components/onboarding/onboarding'
import { PageTitle } from '@/components/page-title'

export default function Page() {
  return (
    <>
      <PageTitle message="welcome" />
      <Welcome />
    </>
  )
}
