import type { Metadata } from 'next'

import { PortalLogin } from '@/components/portal-login'
import { translate } from '@/lib/i18n'

export const metadata: Metadata = { title: translate('signIn') }

export default function PortalLoginPage() {
  return (
    <main>
      <PortalLogin />
    </main>
  )
}
