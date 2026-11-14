import type { Metadata } from 'next'

import { PortalLogin } from '@/components/portal-login'

export const metadata: Metadata = { title: 'Sign in' }

export default function PortalLoginPage() {
  return (
    <main>
      <PortalLogin />
    </main>
  )
}
