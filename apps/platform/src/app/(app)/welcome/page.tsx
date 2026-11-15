import type { Metadata } from 'next'

import { Welcome } from '@/components/onboarding/onboarding'
import { translate } from '@/lib/i18n'

export const metadata: Metadata = { title: translate('welcome') }

export default function Page() {
  return <Welcome />
}
