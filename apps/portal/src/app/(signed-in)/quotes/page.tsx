import type { Metadata } from 'next'

import { PortalQuotes } from '@/components/portal-quotes'
import { translate } from '@/lib/i18n'

export const metadata: Metadata = { title: translate('quotes') }

export default function PortalQuotesPage() {
  return <PortalQuotes />
}
