import type { Metadata } from 'next'

import { SigningPage } from '@/components/signatures/signing-page'
import { translate } from '@/lib/i18n'

// The token is in the URL fragment; no-referrer keeps even the page's address out of any request it makes.
export const metadata: Metadata = {
  title: translate('sign'),
  referrer: 'no-referrer',
  robots: { index: false },
}

export default function SignPage() {
  return <SigningPage />
}
