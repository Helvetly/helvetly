import { PageTitle } from '@/components/page-title'
import { PortalLogin } from '@/components/portal-login'

export default function PortalLoginPage() {
  return (
    <>
      <PageTitle message="signIn" />

      <main>
        <PortalLogin />
      </main>
    </>
  )
}
