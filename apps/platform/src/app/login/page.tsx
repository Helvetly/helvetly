import { Suspense } from 'react'

import { LoginScreen } from '@/components/auth/login-screen'
import { PageTitle } from '@/components/page-title'

export default function LoginPage() {
  return (
    <>
      <PageTitle message="signIn" />
      {/* useSearchParams needs a boundary in a static export. */}
      <Suspense>
        <LoginScreen />
      </Suspense>
    </>
  )
}
