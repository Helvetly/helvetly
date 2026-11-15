import type { Metadata } from 'next'
import { Suspense } from 'react'

import { LoginScreen } from '@/components/auth/login-screen'
import { translate } from '@/lib/i18n'

export const metadata: Metadata = { title: translate('signIn') }

export default function LoginPage() {
  return (
    // useSearchParams needs a boundary in a static export.
    <Suspense>
      <LoginScreen />
    </Suspense>
  )
}
