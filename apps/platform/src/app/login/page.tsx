import type { Metadata } from 'next'
import { Suspense } from 'react'

import { LoginScreen } from '@/components/auth/login-screen'

export const metadata: Metadata = { title: 'Sign in' }

export default function LoginPage() {
  return (
    // useSearchParams needs a boundary in a static export.
    <Suspense>
      <LoginScreen />
    </Suspense>
  )
}
